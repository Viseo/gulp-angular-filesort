'use strict';

const _ = require('lodash');
const minimatch = require('minimatch');
const ngDep = require('ng-dependencies');
const PluginError = require('gulp-util').PluginError;
const through = require('through2');
const toposort = require('toposort');

const PLUGIN_NAME = 'gulp-angular-filesort';

function createSorter(order = []) {
  const options = { matchBase: true, nocase: true };
  const defaultRank = order.length;

  function getRank(file) {
    const path = file.path;
    return _.min(
      // Get the index of the first matching pattern
      _.findIndex(order, pattern => minimatch(path, pattern, options)),
      defaultRank
    );
  }

  return (fileA, fileB) => getRank(fileA) - getRank(fileB);
}

module.exports = function (options = {}) {
  // Create a sorter function for user patterns
  const sorter = createSorter(options.order);

  // Stores non Angular files
  const files = [];
  // Stores modules graph ([moduleFilePath: string, parentModuleId: string])
  const graph = [];
  // Stores modules ({ file: File, files: File[] }) by id
  const idsMap = Object.create(null);
  // Stores modules ({ file: File, files: File[] }) by file path
  const pathsMap = Object.create(null);
  // Stores standalone modules (no dependencies, not depended on)
  const standaloneMap = Object.create(null);

  function getModule(id) {
    return idsMap[id] || (idsMap[id] = { files: [] });
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
      var angular = ngDep(file.contents);
    }
    catch (err) {
      // Fail on malformed files
      error('Error in parsing: "' + file.relative + '", ' + err.message);
      return;
    }

    const { modules = {}, dependencies = [] } = angular;

    // Not an Angular file
    if (_.isEmpty(modules) && _.isEmpty(dependencies)) {
      files.push(file);
      next();
      return;
    }

    // Add modules to the maps
    _.each(modules, (dependencies, id) => {
      const module = pathsMap[file.path] = _.set(getModule(id), 'file', file);
      // The module has no dependencies so it is standalone
      if (_.isEmpty(dependencies)) { standaloneMap[id] = module; }
    });

    // Add dependencies to where they belong
    _.each(dependencies, id => {
      // Do nothing if Angular NG module or declared in same file
      if (id === 'ng' || _.has(modules, id)) { return; } // FIXME
      // If it is a module dependency, then it is a module
      if (_.some(modules, dependencies => _.includes(dependencies, id))) {
        graph.push([file.path, id]);
        // The module is depended on so it is not standalone
        delete standaloneMap[id];
      }
      // If not, then it is an attachment to an existing module
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

    _.chain(graph)
      // Map graph items to mapped modules
      .map(tuple => [pathsMap[tuple[0]], idsMap[tuple[1]]])
      // Sort modules by dependencies
      .thru(toposort)
      // Remove unknown/external dependencies
      .compact()
      // Add standalone modules to the chain
      .concat(_.values(standaloneMap))
      // Get modules declaration and attached files sorted by user patterns
      .flatMap(module => module.files.sort(sorter).concat(module.file))
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
