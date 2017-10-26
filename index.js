'use strict';

const _ = require('lodash');
const gutil = require('gulp-util');
const minimatch = require('minimatch');
const ngDep = require('ng-dependencies');
const through = require('through2');
const toposort = require('toposort');

const PluginError = gutil.PluginError;

const PLUGIN_NAME = 'gulp-angular-filesort';
const NG = 'ng';

function createSorter(patterns) {
  const opt = { matchBase: true, nocase: true };
  const max = patterns.length;

  function getSortRank(file) {
    const path = file.path;
    // matches the first pattern and return its index.
    const i = _.findIndex(patterns, pattern => minimatch(path, pattern, opt));
    return i >= 0 ? i : max;
  }

  return (a, b) => getSortRank(a) - getSortRank(b);
}

module.exports = function (options = {}) {
  const { patterns = [] } = options;

  // Create a sorter function for user patterns
  const sorter = createSorter(patterns);

  // Stores non Angular files
  const files = [];
  // Stores modules graph ([moduleFilePath, parentModuleId])
  const graph = [];
  // Stores modules ({ file, files, standalone }) by id
  const idsMap = Object.create(null);
  // Stores modules ({ file, files, standalone }) by file path
  const pathsMap = Object.create(null);
  // Stores standalone modules (no dependencies, not depended on)
  const standaloneMap = Object.create(null);

  function getModule(id) {
    return idsMap[id] || (idsMap[id] = standaloneMap[id] = {
      standalone: true,
      files: []
    });
  }

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
      var deps = ngDep(file.contents);
    }
    catch (err) {
      // Fail on malformed files
      error('Error in parsing: "' + file.relative + '", ' + err.message);
      return;
    }

    const { modules = {}, dependencies = [] } = deps;

    // Not an Angular file
    if (_.isEmpty(modules) && _.isEmpty(dependencies)) {
      files.push(file);
      next();
      return;
    }

    // Add modules to the maps
    _.each(modules, (dependencies, id) => {
      const module = pathsMap[file.path] = _.set(getModule(id), 'file', file);
      if (!module.standalone) { return; } // TODO: cleanup
      const standalone = module.standalone = _.isEmpty(dependencies);
      if (!standalone) { delete standaloneMap[id]; }
    });

    // Add dependencies to where they belong
    _.each(dependencies, id => {
      const dependencyIn = array => _.includes(array, id);
      // Do nothing if Angular NG module or declared in same file
      if (id === NG || dependencyIn(modules)) { return; }
      // If it is a module dependency, then it is a module
      if (_.some(modules, dependencyIn)) {
        graph.push([file.path, id]);
        standaloneMap[id] = false;
        delete standaloneMap[id];
      }
      // If not, then it is attached to an existing module
      else { getModule(id).files.push(file); }
    });

    next();
  }

  function flush(next) {
    _.chain(idsMap)
      // Get not declared modules
      .filter(module => !module.file)
      // Get their attached files
      .flatMap(module => module.files)
      // Add regular files and sort by user patterns
      .thru(value => value.concat(files).sort(sorter))
      // Push files to the stream
      .each(file => this.push(file))
      // Run the chain
      .value();

    _.chain(standaloneMap)
      // Get modules declaration and attached files sorted by user patterns
      .flatMap(module => [module.file].concat(module.files.sort(sorter)))
      // Push files to the stream
      .each(file => this.push(file))
      // Run the chain
      .value();

    _.chain(graph)
      // Map graph items to mapped modules
      .map(tuple => [pathsMap[tuple[0]], idsMap[tuple[1]]])
      // Sort modules by dependencies
      .thru(toposort)
      // Remove unknown/external dependencies
      .compact()
      // Get modules declaration and attached files sorted by user patterns
      .flatMap(module => module.files.sort(sorter).concat(module.file))
      // Remove duplicates keeping only first occurrences
      .uniq()
      // Get the expected injection order (see toposort's documentation)
      .reverse()
      // Push files to the stream
      .each(file => this.push(file))
      // Run the chain
      .value();

    next();
  }

  return through.obj(transform, flush);
};
