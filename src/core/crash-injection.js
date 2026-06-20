export class InjectedCrashError extends Error {
  constructor(boundary) {
    super(`Injected crash after ${boundary}.`);
    this.name = 'InjectedCrashError';
    this.boundary = boundary;
  }
}

export function maybeInjectCrash(crashAfter, boundary) {
  if (crashAfter === boundary) throw new InjectedCrashError(boundary);
}
