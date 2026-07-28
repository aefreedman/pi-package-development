# pi-package-development

`@aefree/pi-package-development` packages the methods and architecture used to design, maintain, and audit Pi packages.

## Included resources

- Canonical package-development references published through `read_package_reference`
- The `auditing-pi-packages` skill
- The `preparing-pi-package-releases` skill
- The `/audit-package <package-path>` prompt template

## Installation

Install both the reference reader and this package so that the reader tool and package-owned references are active:

```sh
pi install npm:@aefree/pi-package-references
pi install npm:@aefree/pi-package-development
```

For local source development, install dependencies and build before loading both package directories with `pi install <path>`.

The audit and release-preparation skills fail explicitly when required references cannot be read; they do not silently substitute workspace-relative documentation.
