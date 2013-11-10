var EventEmitter = require('events').EventEmitter;

var mkFilter = function (q) {

  var filter = function (doc, req) {
    var i, queues = undefined;
    if (!doc.queues) return false;
    if (doc.queues instanceof Array) {
      for (i = 0; i < queues.length; i++) {
        if (doc.queues[i] !== queues[i]) return false;
      }
      return true;
    } else {
      return doc.queues === queues;
    }
  };

  // Construct a function from the filter template by inserting the queue name for 'undefined'.
  return (new Function('return ' + filter.toString().replace('undefined', JSON.stringify(q))))();

};

var Queue = module.exports = function (q, couch, config) {

  config = config || {};

  EventEmitter.call(this);

  this.q = q;

  this.startkey = q instanceof Array ? q            : q;
  this.endkey   = q instanceof Array ? q.concat({}) : q; 

  this.config = {
    limit:      config.limit      || 10,
    view:       config.view       || 'inactive/byQueue',
    autoremove: config.autoremove || false,
    writeonly:  config.writeonly  || false
  };

  this.couch = couch;

  if (!this.config.writeonly) {
    this.couch.changes({
      since:        'now',
      include_docs: true,
      filter:       mkFilter(q)
    }).on('change', this._onChange.bind(this));
  }

  this.revs  = {};
  this.docs  = {};

  this._synclock = {};
  this._dirty    = {};

};

Queue.prototype = Object.create(EventEmitter.prototype);

Queue.prototype.createWorker = function (id, limit, fn) {
  if (!this.config.writeonly) {
    return new (require('./worker'))(id, this, limit, fn);
  }
  throw new Error('Queue instance is writeonly. Creating workers not supported.');
};

Queue.prototype._onChange = function (change) {
  this.emit('change', change.doc);
};

Queue.prototype._shouldSync = function (jid, cb) {
  var cbs, i;
  this._dirty[jid].push(cb);
  if (this._synclock[jid]) { return; }
  cbs = this._dirty[jid];
  this._dirty[jid] = [];
  this._synclock[jid] = true;
  this.couch.save(jid, this.revs[jid], this.docs[jid], function (err, res) {
    this._synclock[jid] = false;
    if (!err) {
      this.revs[jid] = res.rev;
      this.emit('sync', jid);
    }
    for (i = 0; i < cbs.length; i++) {
      if (typeof cbs[i] === 'function') {
        cbs[i](err);
      }
    }
    if (this._dirty[jid] && this._dirty[jid].length) {
      return this._shouldSync(jid);
    }
  }.bind(this));
};

Queue.prototype.getInactiveJobs = function (cb) {
  this.couch.view(this.config.view, {
    limit:     this.config.limit,
    startkey:  [this.startkey, 0],
    endkey:    [this.endkey, {}],
    revs_info: true
  }, cb);
};

Queue.prototype.tryJob = function (worker, doc, cb) {
  var job = doc.value;
  job.state = 'active';
  job.worker_id = worker;
  this.couch.save(job._id, job._rev, job, function (err, res) {
    if (err) { return cb(err); }
    delete job._id;
    delete job._rev;
    this.revs[res.id]   = res.rev;
    this.docs[res.id]   = job;
    this._dirty[res.id] = [];
    cb(null, res);
  }.bind(this));
};

Queue.prototype.createJob = function (data, cb) {
  this.couch.save({
    worker_id:  null,
    queues:     this.q,
    state:      'inactive',
    priority:   0,
    log:        [],
    data:       data,
    created_at: Date.now()
  }, function (err, res) {
    cb(err, res && res.id);
  });
};

Queue.prototype._removeJob = function (jid) {
  delete this.revs[jid];
  delete this.docs[jid];
  delete this._dirty[jid];
  delete this._synclock[jid];
};

Queue.prototype.jobExists = function (jid) {
  return typeof this.revs[jid] === 'string';
};

Queue.prototype.finishJob = function (jid, cb) {
  this.docs[jid].completed_at = Date.now();
  this._shouldSync(jid, function (err, res) {
    if (err || !this.config.autoremove) {
      this._removeJob(jid);
      if (typeof cb === 'function') {
        cb(err);
      }
    } else {
      this.couch.remove(jid, this.revs[jid], function (err) {
        this._removeJob(jid);
        if (typeof cb === 'function') {
          cb(err);
        }
      }.bind(this));
    }
  }.bind(this));
};

Queue.prototype.setJobState = function (jid, state, cb) {
  this.docs[jid].state = state;
  this._shouldSync(jid, cb);
};

Queue.prototype.logJob = function (jid, log, cb) {
  this.docs[jid].log.push(log);
  this._shouldSync(jid, cb);
};

Queue.prototype.progressJob = function (jid, progress, cb) {
  this.docs[jid].progress = progress;
  this._shouldSync(jid, cb);
};

Queue.prototype.getJobData = function (jid, cb) {
  cb(null, this.docs[jid].data);
};

Queue.prototype.setJobData = function (jid, data, cb) {
  this.docs[jid].data = data;
  this._shouldSync(jid, cb);
};
