'use strict';

const _ = require('lodash');
const minimatch = require('minimatch');
const ngDependencies = require('ng-dependencies');
const PluginError = require('gulp-util').PluginError;
const through = require('through2');
const toposort = require('toposort');

const PLUGIN_NAME = 'gulp-angular-filesort';

function createSorter(order = []) {
  const options = { matchBase: true };
  const maxOrder = order.length;

  function getPath(file) { return file.path.toLowerCase(); }

  function getOrder(path) {
    // Get the index of the first matching pattern
    const i = _.findIndex(order, pattern => minimatch(path, pattern, options));
    return _.clamp(i, 0, maxOrder);
  }

  return function sorter(a, b) {
    a = getPath(a);
    b = getPath(b);
    // Sort by user patterns or alphabetically
    return getOrder(a) - getOrder(b) || a > b ? 1 : -1;
  };
}

module.exports = function gulpAngularFilesort(options = {}) {
  // Create a sorter function for user patterns
  const sorter = createSorter(options.attachmentsOrder);

  // Stores non Angular files
  const files = [];
  // Stores modules graph ([moduleFilePath: string, parentModuleId: string])
  const graph = [];
  // Stores modules ({ file: File[], files: File[] }) by id
  const byIds = Object.create(null);
  // Stores modules ({ file: File[], files: File[] }) by file path
  const byPaths = Object.create(null);
  // Stores standalone modules (no dependencies, not depended on)
  const standalone = Object.create(null);

  function transform(file, encoding, next) {
    const error = err => this.emit('error', new PluginError(PLUGIN_NAME, err));

    // Fail on empty files
    if (file.isNull()) {
      error(
        'File: "'
        + file.relative
        + '" without content. You have to read it with gulp.src(..)'
      );
      return;
    }

    // Streams not supported
    if (file.isStream()) {
      error('Streaming not supported');
      next();
      return;
    }

    try {
      var { modules = {}, dependencies = [] } = ngDependencies(file.contents);
    }
    catch (err) {
      // Fail on malformed files
      error('Error in parsing: "' + file.relative + '", ' + err.message);
      return;
    }

    // Not an Angular file
    if (_.isEmpty(modules) && _.isEmpty(dependencies)) {
      files.push(file);
      next();
      return;
    }

    // Get module by id, storing it if nececessary
    const getModule = id => byIds[id] || (byIds[id] = { file: [], files: [] });

    // Add modules to the maps
    _.each(modules, (dependencies, id) => {
      const module = byPaths[file.path] = getModule(id);
      // The module has no dependencies so it is standalone
      if (_.isEmpty(dependencies)) { standalone[id] = module; }
      // In case the module is declared again with dependencies
      else { delete standalone[id]; }
      // Store declaration files (modules should be defined once but...)
      module.file.push(file);
    });

    // Add dependencies to where they belong
    _.each(dependencies, id => {
      // Do nothing if Angular NG module or declared in same file
      if (id === 'ng' || _.has(modules, id)) { return; }
      // If it is a module dependency, then it is a module
      if (_.some(modules, dependencies => _.includes(dependencies, id))) {
        graph.push([file.path, id]);
        // The module is depended on so it is not standalone
        delete standalone[id];
      }
      // If not, then it is an attachment to an existing module
      else { getModule(id).files.push(file); }
    });

    next();
  }

  function flush(next) {
    _.chain(byIds)
      // Get not declared modules
      .filter(module => _.isEmpty(module.file))
      // Get their attached files
      .flatMap(module => module.files)
      // Add regular files and sort by user patterns
      .thru(value => _.concat(value, files).sort(sorter))
      // Push files to the stream
      .each(file => this.push(file))
      // Run the chain
      .value();

    _.chain(graph)
      // Map graph sring items to module objects
      .map(tuple => [byPaths[tuple[0]], byIds[tuple[1]]])
      // Remove circular dependencies keeping only first occurrences
      .uniqWith((a, b) => a[0] === b[1] && a[1] === b[0])
      // Sort modules by dependencies
      .thru(toposort)
      // Remove unknown/external dependencies
      .compact()
      // Add standalone modules to the chain
      .concat(_.values(standalone))
      // Get modules declaration and attached files sorted by user patterns
      .flatMap(module => _.concat(module.files.sort(sorter), module.file))
      // Remove duplicates keeping only first occurrences
      .uniq()
      // Get the expected injection order (see the toposort documentation)
      .reverse()
      // Push files to the stream
      .each(file => this.push(file))
      // Run the chain
      .value();

    next();
  }

  return through.obj(transform, flush);
};
