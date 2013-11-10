var EventEmitter = require('events').EventEmitter;

var Worker = module.exports = function (id, queue, limit, fn) {

  EventEmitter.call(this);

  this.id = id;
  this.queue = queue;
  this.limit = limit;
  this.interval = null;
  this.last_ping = 0;
  this.fn = fn;
  this.paused = false;
  this.workingInstances = 0;

  queue.on('change', this._onChange.bind(this));

};

Worker.prototype = Object.create(EventEmitter.prototype);

Worker.prototype._onChange = function () {
  this.last_ping = new Date().getTime();
  this.wakeUp();
};

Worker.prototype.wakeUp = function () {
  if (!this.interval && !this.paused) {
    this.interval = setInterval(this._run.bind(this), 300 + Math.random() * 100 - 50);
    this.emit('wakeup');
  }
  return this;
};

Worker.prototype.goToSleep = function () {
  clearInterval(this.interval);
  this.interval = null;
  this.emit('sleep');
};

Worker.prototype.pause = function () {
  this.paused = true;
};

Worker.prototype.resume = function () {
  this.paused = false;
};

Worker.prototype._threadEnter = function () {
  this.workingInstances++;
  this.emit('load', this.workingInstances, this.limit);
};

Worker.prototype._threadExit = function () {
  this.workingInstances--;
  this.emit('load', this.workingInstances, this.limit);
};

Worker.prototype._run = function () {
  var self = this;

  if (self.workingInstances < self.limit && !self.paused) {

    self._threadEnter();

    self.queue.getInactiveJobs(function (err, docs) {

      if (err) {
        console.log(err);
        return self._threadExit();
      }

      if (docs.length === 0) {
        if (self.last_ping < Date.now() - 5000) {
          self.goToSleep();
        }
        return self._threadExit();
      }

      var _loop = function () {

        if (self.paused) {
          return self._threadExit();
        }

        var doc = docs.shift();
        if (!doc) {
          return self._threadExit();
        }

        self.queue.tryJob(self.id, doc, function (err, res) {

          if (err) {
            return _loop();
          }

          self.fn(res.id, function (err) {
            if (!self.queue.jobExists(res.id)) {
              throw new Error('Callback called for unknown job. The callback should not be called more than once.');
            }
            if (err) {
              return self.queue.setJobState(res.id, 'failed', function (err) {
                if (err) return self._threadExit();
                self.queue.finishJob(res.id, function (err) {
                  return self._threadExit();
                });
              });
            }
            self.queue.setJobState(res.id, 'complete', function (err) {
              if (err) return self._threadExit();
              self.queue.finishJob(res.id, function (err) {
                return self._threadExit();
              });
            });
          });

        });

      };

      _loop();

    });

  }

};
