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

  // Create a sorter function for user preferencies
  const sorter = createSorter(patterns);

  // Stores non Angular files
  const files = [];
  // Stores modules graph ([module file path, parent module id])
  const tuples = [];
  // Stores modules ({ file: File, attachments: File[] }) by id
  const idsMap = {};
  // Stores modules ({ file: File, attachments: File[] }) by file path
  const pathsMap = {};

  function getModule(name) {
    if (_.has(idsMap, name)) { return idsMap[name]; }
    return idsMap[name] = { attachments: [] };
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
    if (_.isEmpty(dependencies) && _.isEmpty(modules)) {
      files.push(file);
      next();
      return;
    }

    // Add modules to the maps
    _.each(modules, (dependencies, name) => {
      const module = getModule(name);
      pathsMap[file.path] = module;
      module.file = file;
    });

    // Add dependencies to where they belong
    _.each(dependencies, name => {
      const dependencyIn = array => _.includes(array, name);
      // Do nothing if Angular NG module or declared in same file
      if (name === NG || dependencyIn(modules)) { return; }
      // If it is a module dependency, then it is a module
      if (_.some(modules, dependencyIn)) { tuples.push([file.path, name]); }
      // If not, then it is attached to an existing module
      else { getModule(name).attachments.push(file); }
    });

    next();
  }

  function flush(next) {
    _.chain(idsMap)
      // Get not declared modules
      .filter(module => !module.file)
      // Get their attachments
      .flatMap(module => module.attachments)
      // Add regular files, and sort by user preferencies
      .thru(values => values.concat(files).sort(sorter))
      // Push files to the stream
      .each(file => this.push(file))
      .value();

    _.chain(tuples)
      // Exclude external dependencies
      .filter(tuple => _.has(idsMap, tuple[1]))
      // Map tuples items to mapped modules
      .map(tuple => [pathsMap[tuple[0]], idsMap[tuple[1]]])
      // Sort modules and reverse to get the correct injection order
      .thru(values => toposort(values).reverse())
      // Get an array of modules files sorted by user preferencies
      .flatMap(module => [module.file].concat(module.attachments.sort(sorter)))
      // Push files to the stream
      .each(file => this.push(file))
      .value();

    next();
  }

  return through.obj(transform, flush);
};
