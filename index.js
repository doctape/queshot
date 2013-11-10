exports.Queue  = require('./queue');
exports.Worker = require('./worker');

exports.createQueue = function (q, couch, config) {
  return new exports.Queue(q, couch, config);
};
