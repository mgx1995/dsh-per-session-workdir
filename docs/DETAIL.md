# Per-session working directory

Every DeepSeek Harness conversation gets its own working folder, so files from different conversations never mix in one directory.

## What it does

- On open (`agent/created`), the plugin creates a folder named `YYYY-MM-DD_HH-MM-SS` under the workspace root and switches the Session's effective working directory to it via the built-in `workingDirectory` service.
- The name comes from the Session's immutable `header.createdAt` (local time), not the current clock: reopening the same Session always resolves to the same folder.
- The sidebar file tree follows the Session working directory, so each conversation sees only its own files.
- Folders are preserved when a Session closes; nothing is deleted automatically.
- If folder creation or the directory change fails, the Session keeps its original working directory and the conversation is unaffected.

## Install

```sh
dsh plugin --profile <profile> add github:mgx1995/dsh-per-session-workdir
```
