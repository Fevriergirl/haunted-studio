# Data, rights, and provenance

## Runtime data

Studio ledgers, state, reviews, reports, images, mailbox messages, and experiment
outputs are generated runtime data. They are ignored by Git and must not be
published without deliberate review.

Before sharing a derived artifact:

1. remove credentials, local paths, private observations, and direct personal
   identifiers;
2. confirm reviewer consent and the allowed scope of publication;
3. confirm rights for observations, reference images, training or source
   material, and generated output;
4. retain provider, model, configuration, intention, and curation provenance;
5. state whether an image was generated and whether its internal audit passed;
6. label simulated audience predictions separately from human responses; and
7. retain negative, rejected, and failed outcomes needed to interpret results.

## Observation metadata

Each observation should include a stable ID, source, text, tags, and a rights
label. A rights label is an assertion supplied by the contributor, not legal
verification. Operators must investigate ambiguous or third-party material.

## Human reviews

Reviews require `consent: true`. Prefer pseudonymous reviewer IDs. Consent to
participate does not automatically mean consent to publish raw text or identity.

## Images and models

Do not submit private photographs, confidential material, or unlicensed artwork
to a live provider. Provider terms, model availability, and output rights may
change; review the applicable terms before each study or publication.

## Authorship

The ledger records contributions and decisions but does not determine legal or
artistic authorship. Make authorship and disclosure decisions explicitly and do
not attribute subjective experience to the software.
