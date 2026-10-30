# MOMM 1.18 authentication policy - development, not installed

The current development and pilot policy is OAuth/account sessions only. Never
provide, request, read, print, or fall back to API keys. Existing signed 1.17.3
remains unchanged.

The 11 October optional-key proposal is superseded for the current qualification
work. A historical profile preference or legacy adapter is not permission to
activate that mode. OAuth failure remains an OAuth status and never triggers a
credential substitution.

A real OAuth pilot still needs an authenticated owner consent/session, reviewed
TLS and registration, protected token custody, exact disclosure and logging
bindings, finite single-use authority, and authoritative backend task and physical
release evidence. Unknown remote work retains its original holds. Offline tests
and network reachability do not establish those properties.

Native live activation and initial Bumble release-quorum votes remain disabled.
Publishing this development branch does not install a protocol or release 1.18.
