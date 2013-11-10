var cradle = require('cradle'),
    CQ = require('../index');

var couch = new cradle.Connection('http://localhost', 5984, {cache: false, raw: false});

var queue = CQ.createQueue('docs', couch.database('queue'));

var w = queue.createWorker('worky', 1, function (jid, done) {
  console.log('got ' + jid);
  queue.getJobData(jid, function (err, data) {
    console.log('Data: ' + JSON.stringify(data));
    done();
  });
}).wakeUp();

setInterval(function () {
  queue.createJob('123', function (err, jid) {
    if (err) console.log(err);
    console.log('created ' + jid)
  });
}, 1000);
