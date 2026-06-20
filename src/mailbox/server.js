import http from 'node:http';
import { assertOperationCompatible } from '../core/operations.js';
import { maybeInjectCrash } from '../core/crash-injection.js';

const MAX_BODY_BYTES = 1_000_000;

function sendJson(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(JSON.stringify(body));
}

function requestError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function readBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) throw requestError('Request body exceeds 1 MB.', 413);
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw requestError('Request body must be valid JSON.');
  }
}

export function startMailboxServer({ mailbox, ledger, port = 19820, host = '127.0.0.1', crashAfter = null }) {
  let crashInjected = false;
  const server = http.createServer(async (request, response) => {
    try {
      if (request.method === 'GET' && request.url === '/health') {
        return sendJson(response, 200, { status: 'ok' });
      }
      if (request.method === 'POST' && request.url === '/mailbox/receive') {
        const body = await readBody(request);
        if (!body.type) return sendJson(response, 400, { error: 'type is required' });
        const message = await mailbox.receive(body);
        const events = await ledger.readAll();
        const prior = assertOperationCompatible(events, message.operation_id, message.operation_fingerprint)
          .find((event) => event.type === 'mailbox_message_received');
        if (!prior) {
          await ledger.append({
            type: 'mailbox_message_received',
            actor: 'mailbox-server',
            payload: {
              message_id: message.message_id,
              message_type: message.type,
              sender: message.sender,
              operation_id: message.operation_id,
              operation_fingerprint: message.operation_fingerprint
            }
          });
        }
        if (!crashInjected && crashAfter === 'mailbox_message_received') {
          crashInjected = true;
          maybeInjectCrash(crashAfter, 'mailbox_message_received');
        }
        return sendJson(response, 202, { message_id: message.message_id, status: 'received' });
      }
      if (request.method === 'POST' && request.url === '/mailbox/poll') {
        const body = await readBody(request);
        return sendJson(response, 200, { messages: await mailbox.poll(body) });
      }
      if (request.method === 'POST' && request.url === '/mailbox/ack') {
        const body = await readBody(request);
        const count = await mailbox.acknowledge(body.message_ids ?? []);
        return sendJson(response, 200, { acknowledged: count });
      }
      return sendJson(response, 404, { error: 'not found' });
    } catch (error) {
      const status = error.statusCode ?? (
        error.message.startsWith('Mailbox ') ||
        error.message.startsWith('message_ids') ||
        error.message.startsWith('Operation conflict')
          ? 400
          : 500
      );
      return sendJson(response, status, { error: error.message });
    }
  });

  server.listen(port, host);
  return server;
}
