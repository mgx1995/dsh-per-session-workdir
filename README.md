# dsh-per-session-workdir

Give every DeepSeek Harness conversation its own working folder instead of writing all files into one shared directory.

## What it does

When a Session opens, the plugin creates a sub-folder under the workspace root named after the Session's creation time (`YYYY-MM-DD_HH-MM-SS`, local time) and points that Session's durable working directory at it.

- Files written by one conversation land in its own folder, not a shared one.
- The folder name derives from the immutable `header.createdAt`, so a resumed Session always returns to the same folder.
- The sidebar file tree follows the working directory; switching Sessions shows each one's own files.
- Folders are kept after a Session closes — nothing is deleted automatically.
- On failure the Session simply keeps its original working directory.

## Install

```sh
dsh plugin --profile <profile> add github:mgx1995/dsh-per-session-workdir
```

Or find **Per-session working directory** in the dsh-market plugin market.

## How it works

The plugin listens to the `agent/created` event, creates the folder with `node:fs/promises`, and calls the built-in `ctx.workingDirectory.set(agent, path)`. The directory change is persisted in the Session log through the standard `working-directory/change` event.

## License

MIT
