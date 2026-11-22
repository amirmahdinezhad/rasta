# Rasta workflows

For desktop releases, compatibility checks or RTL broken after an update:

- If the user names a supported app, inspect that app directly.
- If no app is named for a host compatibility request, ask which app has a new version and wait.
- Read the target version and build from the actual bundle and its ASAR when present.
- Preserve original app logic, download verification, signing and rollback.
  Keep Codex integrity active and retain T3's vendor integrity setting.
- Keep each app's state, backups, jobs, packages and update feeds independent.
- Finish local diagnosis, fixes, relevant tests and candidate preparation.
  The user performs Launch and manual acceptance; do not close or replace the
  original app yourself. Automated tests do not establish manual acceptance.
- Test every release from the previous installed connection in Rasta.app Library.
  If a baseline needs installing, provide a signed test feed or test manager
  that prepares it from Library. Keep that baseline installed until the user
  starts the candidate update. Separate Setup apps are internal or legacy tools.
- Record acceptance for each affected app: Library offers the intended version,
  the download and installation complete after Launch, the app card shows the
  installed version, and the host works. Share the exact signed candidate DMGs directly
  with the owner. Repeat the Library check after publication. Check the
  host's update shortcut separately when it changes.
- Publish only with explicit GitHub authorization and manual acceptance for
  app packages. Verify published downloads separately from local candidates.

## Local UI preview before packaging

- Start UI iteration on localhost using `npm run preview:manager`. Keep the preview
  running while the user tests and requests changes; share its actual URL.
- Preview interactions simulate connection state, downloads, installation and
  removal. Label them as simulated and keep installed apps and their data untouched.
  Browser preview approval is UI feedback, not native installation acceptance.
- Keep changes and test runs local during iteration. An explicit request for an
  installer authorizes local packaging at the existing version after checks pass.
  Browser approval alone authorizes neither packaging nor publication.

## Manager interface

- Build manager UI components with shadcn/ui and style them with Tailwind utilities.
  Keep custom CSS limited to shared theme tokens, font declarations and cases that
  Tailwind cannot reasonably express; document those exceptions at their source.
- Open each connection's settings and installation progress in a shadcn Dialog.
  Use shadcn controls for buttons, selects, switches, tabs, progress and confirmation.
  Do not use native browser dialogs, native select menus or platform UI controls
  inside the manager interface. Keep semantic HTML underneath the components.
- Preserve the chosen Library card layout, independent app preferences, explicit
  Launch, keyboard focus management and reduced-motion behavior.

## Shared host panel

- Use the same panel and feature set in every supported host unless the user
  explicitly requests a host-specific feature. Keep host adapters limited to
  native integration and independent preferences.
- Build the shared panel from the current source for every packaged output.
  For installs and updates, use the latest compatible package from the
  selected host's signed feed. Reuse a download only when its digest matches
  that feed; preserve offline repair from an installed compatible runtime.

## Reusable UI skill maintenance

- During UI iteration, keep `~/.codex/skills/crafted-shadcn-ui` aligned with explicit
  reusable user corrections and verified design or interaction lessons.
- Keep app names, release rules, connection logic and Rasta-only visual preferences
  in this project. Give contextual rules their conditions instead of making every
  correction universal; revise an existing rule before adding a duplicate.
- When the skill changes, validate it and run `python3 tools/export-ui-skill.py` to
  refresh its portable ZIP and manifest. Report the reusable change separately
  from the product edit. Skill export is separate from app installer packaging.

## Release ownership and required checks

- Keep every app and release version unchanged until the owner explicitly
  requests a version change. Scope that approval to the named version. Keep all
  version-bearing package manifests and English release notes synchronized.
- Obtain separate explicit owner authorization before publishing the exact
  candidate, tag, installer or feed update to GitHub. Public publication also
  requires the owner's native acceptance of that exact candidate. Give the owner
  the local installer for manual replacement and feedback before publication.
- Before each packaged build, follow [the release workflow](docs/development-workflow.md)
  and [the security checklist](docs/development-workflow.md#release-security-checks). Run
  `npm run release:check` on the exact source and lockfiles. Check dependencies,
  repository secrets, host integrity and isolation, update authentication, safe
  installation and rollback. A failed or unavailable required check blocks
  packaging and publication. Fix the cause and rerun the checks on the candidate.
- Record the version, source commit, check and scanner versions, outcomes,
  evidence, findings and remaining verification per architecture and host.
  Keep credentials and account data out of source, logs, fixtures and outputs.
  Base claims on the tests and threat surfaces actually checked.
- Build locally from the exact reviewed commit. Produce an Apple Silicon
  (`darwin-arm64`) DMG and updater archive for the current release. Verify the
  single-architecture executables, signatures, checksums, DMG contents and
  matching signed feed entries before uploading. Keep the existing release
  verification key and each host's integrity and rollback behavior.
- Upload approved bytes to a draft. Verify the draft downloads, publish only
  after they match, then independently check the published downloads and feeds.
  Rerun the automated security gate before publication. Check Library against
  the public feeds after publication.
- Use public `origin` at `amirmahdinezhad/rasta`. GitHub Actions verifies source
  on both architectures.
  Use the authorised local release scripts for packages and uploads.
- Test the Apple Silicon release through Library from the previous installed connection.
  Record the manager and each public host separately. The owner chooses Launch
  and confirms the installed version and working host. Promote the accepted
  source and exact ZIP and DMG bytes without rebuilding.

## Repository cleanup and bundle size

- Review references and provenance before removing redundant files, old Markdown
  drafts, superseded preview outputs and build caches. Preserve active work,
  evidence, release and rollback artifacts, third-party notices, app data and
  signing material. Keep one current source for each operational procedure.
- Measure production bundle, DMG and updater archive sizes per architecture
  against a comparable build. Remove unused code, dependencies and duplicate
  resources. Share the verified runtime across compact connection packages.
  Preserve offline repair, accessibility and the security and integrity checks.
- For the README, use Orbilap's order of artwork, badges, app preview,
  installation, updates, removal and license. Keep one Rasta-branded illustration
  and one current product preview. Keep theme descriptions and alternate theme
  previews out of the README.
- Use the black tile and white strokes for app icons and documentation artwork.
  Use appearance-adaptive marks in the Library header and in-app reading controls.

## Product scope

The eight macOS connections in Rasta.app Library are Codex, T3 Code,
Antigravity, Claude, OpenCode, ZCode, Grok Bot, and Gemini. The Apple Silicon
1.0.0 release and signed local test builds include the full catalog. Keep installation,
updates, removal, host packages and runtime helpers in the Library flow.
Add app targets or web distributions only when the user explicitly requests them.

## Language policy

Write all app and Setup labels, descriptions, errors, service output, release notes,
code comments, agent instructions and documentation in English. The only Persian
guide belongs in the `persian-documentation` section of the root `README.md`.
Keep that section separate from the English guide. Persian/Arabic text used as
RTL test data, reading samples, font names or character-matching logic is content,
not explanatory copy; preserve it where required to verify RTL behavior. Write
instructions surrounding those samples in English.

Before completing a change, run `npm run test:language` and the relevant tests.
Maintain the language check's narrow sample exceptions when adding RTL fixtures.
