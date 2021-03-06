---
id: api
title: API
---

## Methods

<AUTOGENERATED_TABLE_OF_CONTENTS>

---

## Quick Start

  - Compile a file

    ```
    await Metro.runBuild({
      entry: 'index.js',
      out: 'bundle.js',
      config: Metro.loadMetroConfiguration(),
    });
    ```

  - Run a server & watch the filesystem for changes

    ```
    await Metro.runServer({
      port: 8080,
      config: Metro.loadMetroConfiguration(),
    });
    ```

## Reference

All functions exposed below accept an additional `config` option. This object should be the [Metro configuration](CLI.md) exposed by your `metro.config.js` file - you can obtain it by simply requiring this file.

### `loadMetroConfiguration(filepath?: string, <options>)`

**Basic options:** `cwd`, `basename`

Load the Metro configuration, either from `filepath` if specified, or by traversing the directory hierarchy from `cwd` to the root until it finds a file named `basename` (by default `metro.config.js`). The returned configuration will have been normalized and merged with Metro's default values.

### `findMetroConfiguration(filepath?: string, <options>)`

**Basic options:** `cwd`, `basename`

Same as above, but only locates the file.

### `async runBuild(<options>)`

**Required options:** `entry`, `out`

**Basic options:** `dev`, `optimize`, `platform`, `sourceMap`, `sourceMapUrl`

Bundles `entry` for the given `platform`, and saves it to location `out`. If `sourceMap` is set, also generates a source map. The source map will be inlined, unless `sourceMapUrl` is also defined. In the latter case, a new file will be generated with the basename of the `sourceMapUrl` parameter

### `async runServer(<options>)`

**Basic options:** `host`, `port`, `secure`, `secureKey`, `secureCert`, `hmrEnabled`

Starts a full Metro HTTP server. It will listen on the specified `host:port`, and can then be queried to retrieve bundles for various entry points. If the `secure` family of options are present, the server will be exposed over HTTPS. If `hmrEnabled` is set, the server will also expose a websocket server and inject the HMR client into the generated bundles.

### `createConnectMiddleware(<options>)`

**Basic options:** `port`

Instead of creating the full server, creates a Connect middleware that answers to bundle requests. This middleware can then be plugged into your own servers. The `port` parameter is optional and only used for logging purposes.
