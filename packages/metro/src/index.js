/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @flow
 * @format
 */

'use strict';

const Config = require('./Config');
const MetroHmrServer = require('./HmrServer');
const MetroServer = require('./Server');
const TerminalReporter = require('./lib/TerminalReporter');
const TransformCaching = require('./lib/TransformCaching');

const attachWebsocketServer = require('./lib/attachWebsocketServer');
const defaults = require('./defaults');
const fs = require('fs');
const getMaxWorkers = require('./lib/getMaxWorkers');
const http = require('http');
const https = require('https');
const outputBundle = require('./shared/output/bundle');
const path = require('path');

const {realpath} = require('fs');
const {readFile} = require('fs-extra');
const {Terminal} = require('metro-core');

import type {ConfigT} from './Config';
import type {GlobalTransformCache} from './lib/GlobalTransformCache';
import type {Options as ServerOptions} from './shared/types.flow';
import type {Reporter} from './lib/reporting';
import type {RequestOptions, OutputOptions} from './shared/types.flow.js';
import type {TransformCache} from './lib/TransformCaching';
import type {Server as HttpServer} from 'http';
import type {Server as HttpsServer} from 'https';

export type {ConfigT} from './Config';

type DeprecatedMetroOptions = {|
  resetCache?: boolean,
|};

type PublicMetroOptions = {|
  ...DeprecatedMetroOptions,
  config?: ConfigT,
  globalTransformCache?: ?GlobalTransformCache,
  maxWorkers?: number,
  port?: ?number,
  reporter?: Reporter,
  transformCache?: TransformCache,
|};

type PrivateMetroOptions = {|
  ...PublicMetroOptions,
  watch?: boolean,
|};

type MetroConfigSearchOptions = {|
  cwd?: string,
  basename?: string,
|};

const METRO_CONFIG_FILENAME = 'metro.config.js';

// We'll be able to remove this to use the one provided by modern versions of
// fs-extra once https://github.com/jprichardson/node-fs-extra/pull/520 will
// have been merged (until then, they'll break on devservers/Sandcastle)
async function asyncRealpath(path): Promise<string> {
  return new Promise((resolve, reject) => {
    realpath(path, (error, result) => {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    });
  });
}

async function runMetro({
  config,
  globalTransformCache,
  resetCache = false,
  maxWorkers = getMaxWorkers(),
  // $FlowFixMe TODO t0 https://github.com/facebook/flow/issues/183
  port = null,
  reporter = new TerminalReporter(new Terminal(process.stdout)),
  transformCache = TransformCaching.useTempDir(),
  watch = false,
}: PrivateMetroOptions): Promise<MetroServer> {
  const normalizedConfig = config ? Config.normalize(config) : Config.DEFAULT;

  const assetExts = defaults.assetExts.concat(
    (normalizedConfig.getAssetExts && normalizedConfig.getAssetExts()) || [],
  );
  const sourceExts = defaults.sourceExts.concat(
    (normalizedConfig.getSourceExts && normalizedConfig.getSourceExts()) || [],
  );
  const platforms =
    (normalizedConfig.getPlatforms && normalizedConfig.getPlatforms()) || [];

  const providesModuleNodeModules =
    typeof normalizedConfig.getProvidesModuleNodeModules === 'function'
      ? normalizedConfig.getProvidesModuleNodeModules()
      : defaults.providesModuleNodeModules;

  const finalProjectRoots = await Promise.all(
    normalizedConfig.getProjectRoots().map(path => asyncRealpath(path)),
  );

  reporter.update({
    type: 'initialize_started',
    port,
    projectRoots: finalProjectRoots,
  });
  const serverOptions: ServerOptions = {
    assetExts: normalizedConfig.assetTransforms ? [] : assetExts,
    assetRegistryPath: normalizedConfig.assetRegistryPath,
    blacklistRE: normalizedConfig.getBlacklistRE(),
    createModuleIdFactory: normalizedConfig.createModuleIdFactory,
    dynamicDepsInPackages: normalizedConfig.dynamicDepsInPackages,
    extraNodeModules: normalizedConfig.extraNodeModules,
    getPolyfills: normalizedConfig.getPolyfills,
    getModulesRunBeforeMainModule:
      normalizedConfig.getModulesRunBeforeMainModule,
    getTransformOptions: normalizedConfig.getTransformOptions,
    globalTransformCache,
    hasteImplModulePath: normalizedConfig.hasteImplModulePath,
    maxWorkers,
    platforms: defaults.platforms.concat(platforms),
    postMinifyProcess: normalizedConfig.postMinifyProcess,
    postProcessModules: normalizedConfig.postProcessModules,
    postProcessBundleSourcemap: normalizedConfig.postProcessBundleSourcemap,
    providesModuleNodeModules,
    resetCache,
    reporter,
    sourceExts: normalizedConfig.assetTransforms
      ? sourceExts.concat(assetExts)
      : sourceExts,
    transformCache,
    transformModulePath: normalizedConfig.getTransformModulePath(),
    watch,
    workerPath:
      normalizedConfig.getWorkerPath && normalizedConfig.getWorkerPath(),
    projectRoots: finalProjectRoots,
  };

  return new MetroServer(serverOptions);
}

type CreateConnectMiddlewareOptions = {|
  ...PublicMetroOptions,
|};

exports.createConnectMiddleware = async function({
  config,
  ...rest
}: CreateConnectMiddlewareOptions) {
  // $FlowFixMe Flow doesn't support object spread enough for the following line
  const metroServer = await runMetro({
    ...rest,
    config,
    watch: true,
  });

  const normalizedConfig = config ? Config.normalize(config) : Config.DEFAULT;

  let enhancedMiddleware = metroServer.processRequest;

  // Enhance the resulting middleware using the config options
  if (normalizedConfig.enhanceMiddleware) {
    enhancedMiddleware = normalizedConfig.enhanceMiddleware(enhancedMiddleware);
  }

  return {
    attachHmrServer(httpServer: HttpServer | HttpsServer) {
      attachWebsocketServer({
        httpServer,
        path: '/hot',
        websocketServer: new MetroHmrServer(metroServer),
      });
    },
    metroServer,
    middleware: enhancedMiddleware,
    end() {
      metroServer.end();
    },
  };
};

type RunServerOptions = {|
  ...PublicMetroOptions,
  host?: string,
  onReady?: (server: HttpServer | HttpsServer) => void,
  port?: number,
  secure?: boolean,
  secureKey?: string,
  secureCert?: string,
  hmrEnabled?: boolean,
|};

exports.runServer = async ({
  host,
  onReady,
  // $FlowFixMe Flow messes up when using "destructuring"+"default value"+"spread typing"+"stricter field typing" together
  port = 8080,
  reporter = new TerminalReporter(new Terminal(process.stdout)),
  secure = false,
  secureKey,
  secureCert,
  hmrEnabled = false,
  ...rest
}: RunServerOptions) => {
  // Lazy require
  const connect = require('connect');

  const serverApp = connect();

  const {
    attachHmrServer,
    middleware,
    end,
    // $FlowFixMe Flow doesn't support object spread enough for the following line
  } = await exports.createConnectMiddleware({
    ...rest,
    port,
    reporter,
  });

  serverApp.use(middleware);

  let httpServer;

  if (secure) {
    httpServer = https.createServer(
      {
        key: await readFile(secureKey),
        cert: await readFile(secureCert),
      },
      serverApp,
    );
  } else {
    httpServer = http.createServer(serverApp);
  }

  if (hmrEnabled) {
    attachHmrServer(httpServer);
  }

  httpServer.listen(port, host, () => {
    onReady && onReady(httpServer);
  });

  // Disable any kind of automatic timeout behavior for incoming
  // requests in case it takes the packager more than the default
  // timeout of 120 seconds to respond to a request.
  httpServer.timeout = 0;

  httpServer.on('error', error => {
    end();
  });

  httpServer.on('close', () => {
    end();
  });

  return httpServer;
};

type RunBuildOptions = {|
  ...PublicMetroOptions,
  entry: string,
  out: string,
  dev?: boolean,
  onBegin?: () => void,
  onProgress?: (transformedFileCount: number, totalFileCount: number) => void,
  onComplete?: () => void,
  optimize?: boolean,
  output?: {
    build: (
      MetroServer,
      RequestOptions,
    ) => Promise<{code: string, map: string}>,
    save: (
      {code: string, map: string},
      OutputOptions,
      (...args: Array<string>) => void,
    ) => Promise<mixed>,
  },
  platform?: string,
  sourceMap?: boolean,
  sourceMapUrl?: string,
|};

exports.runBuild = async ({
  config,
  dev = false,
  entry,
  onBegin,
  onComplete,
  onProgress,
  optimize = false,
  output = outputBundle,
  out,
  platform = `web`,
  sourceMap = false,
  sourceMapUrl,
  ...rest
}: RunBuildOptions) => {
  // $FlowFixMe Flow doesn't support object spread enough for the following line
  const metroServer = await runMetro({
    ...rest,
    config,
  });

  const requestOptions: RequestOptions = {
    dev,
    entryFile: entry,
    inlineSourceMap: sourceMap && !!sourceMapUrl,
    minify: optimize,
    platform,
    sourceMapUrl: sourceMap === false ? undefined : sourceMapUrl,
    createModuleIdFactory: config ? config.createModuleIdFactory : undefined,
    onProgress,
  };

  if (onBegin) {
    onBegin();
  }

  let metroBundle;

  try {
    metroBundle = await output.build(metroServer, requestOptions);
  } catch (error) {
    await metroServer.end();
    throw error;
  }

  if (onComplete) {
    onComplete();
  }

  const bundleOutput = out.replace(/(\.js)?$/, '.js');
  const sourcemapOutput =
    sourceMap === false ? undefined : out.replace(/(\.js)?$/, '.map');

  const outputOptions: OutputOptions = {
    bundleOutput,
    sourcemapOutput,
    dev,
    platform,
  };

  await output.save(metroBundle, outputOptions, console.log);
  await metroServer.end();

  return {metroServer, metroBundle};
};

exports.findMetroConfig = function(
  filename: ?string,
  {
    cwd = process.cwd(),
    basename = METRO_CONFIG_FILENAME,
  }: MetroConfigSearchOptions = {},
): ?string {
  if (filename) {
    return path.resolve(cwd, filename);
  } else {
    let previous;
    let current = cwd;

    do {
      const filename = path.join(current, basename);

      if (fs.existsSync(filename)) {
        return filename;
      }

      previous = current;
      current = path.dirname(current);
    } while (previous !== current);

    return null;
  }
};

exports.loadMetroConfig = function(
  filename: ?string,
  // $FlowFixMe: This is a known Flow issue where it doesn't detect that an empty object is a valid value for a strict shape where all the members are optionals
  searchOptions: MetroConfigSearchOptions = {},
): ConfigT {
  const location = exports.findMetroConfig(filename, searchOptions);

  // $FlowFixMe: We want this require to be dynamic
  const config = location ? require(location) : null;

  return config ? Config.normalize(config) : Config.DEFAULT;
};

exports.Config = Config;
exports.defaults = defaults;

// The symbols below belong to the legacy API and should not be relied upon
Object.assign(exports, require('./legacy'));
