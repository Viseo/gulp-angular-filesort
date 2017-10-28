/* jshint camelcase: false, strict: false */
/* global describe, it */

const angularFilesort = require('../.');
const File = require('gulp-util').File;
const path = require('path');
const readFileSync = require('fs').readFileSync;
const should = require('chai').should();

function fixture(file, noContents) {
  const filePath = path.join(__dirname, file);
  return new File({
    path: filePath,
    cwd: __dirname,
    base: __dirname,
    contents: noContents ? undefined : readFileSync(filePath)
  });
}

function sort(files, checkResults, handleError) {
  const stream = angularFilesort();
  const resultFiles = [];

  stream.on('error', err => {
    if (handleError) { handleError(err); }
    else {
      should.exist(err);
      done(err);
    }
  });

  stream.on('data', file => {
    const filePath = file.relative.split(path.sep).join('/');
    resultFiles.push(filePath);
  });

  stream.on('end', () => checkResults(resultFiles));

  files.forEach(file => stream.write(file));
  stream.end();
}

function shouldBeBefore(array, itemA, itemB) {
  array.indexOf(itemB).should.be.above(array.indexOf(itemA));
}

describe('gulp-angular-filesort', () => {
  it('should sort file with a module definition before files that uses it', done => {
    const files = [
      fixture('fixtures/another-factory.js'),
      fixture('fixtures/another.js'),
      fixture('fixtures/module-controller.js'),
      fixture('fixtures/no-deps.js'),
      fixture('fixtures/module.js'),
      fixture('fixtures/dep-on-non-declared.js'),
      fixture('fixtures/yet-another.js')
    ];

    sort(files, resultFiles => {
      resultFiles.length.should.equal(7);
      shouldBeBefore(resultFiles, 'fixtures/module.js', 'fixtures/module-controller.js');
      shouldBeBefore(resultFiles, 'fixtures/another.js', 'fixtures/yet-another.js');
      shouldBeBefore(resultFiles, 'fixtures/another.js', 'fixtures/another-factory.js');
      done();
    });
  });

  it('should sort files alphabetically when no ordering is required', done => {
    const files = [
      fixture('fixtures/module.js'),
      fixture('fixtures/circular3.js'),
      fixture('fixtures/module-controller.js'),
      fixture('fixtures/circular.js'),
      fixture('fixtures/circular2.js'),
    ];

    sort(files, resultFiles => {
      resultFiles.length.should.equal(5);
      shouldBeBefore(resultFiles, 'fixtures/circular.js', 'fixtures/circular2.js');
      shouldBeBefore(resultFiles, 'fixtures/circular2.js', 'fixtures/circular3.js');
      shouldBeBefore(resultFiles, 'fixtures/circular.js', 'fixtures/module.js');
      shouldBeBefore(resultFiles, 'fixtures/module.js', 'fixtures/module-controller.js');
      done();
    });
  });

  it('should not crash when a module is both declared and used in the same file (#5)', done => {
    const files = [fixture('fixtures/circular.js')];

    sort(files, resultFiles => {
      resultFiles.length.should.equal(1);
      resultFiles[0].should.equal('fixtures/circular.js');
      done();
    });
  });

  it('should not crash when a module is used inside a declaration'
    + ' even though it\'s before that module\'s declaration (#7)', done => {
    const files = [
      fixture('fixtures/circular2.js'),
      fixture('fixtures/circular3.js')
    ];

    sort(files, resultFiles => {
      resultFiles.length.should.equal(2);
      resultFiles.should.contain('fixtures/circular2.js');
      resultFiles.should.contain('fixtures/circular3.js');
      done();
    });
  });

  it('fails for not read file', done => {
    const files = [fixture('fake.js', true)];

    sort(files, () => {}, err => {
      should.exist(err);
      done()
    });
  });

  it('does not fail for empty file', done => {
    const files = [fixture('fixtures/empty.js')];

    sort(files, resultFiles => {
      resultFiles.should.eql(['fixtures/empty.js'])
      done();
    });
  });
});
