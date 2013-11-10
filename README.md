# Queshot
_A simple worker queue based on couchdb_

## Installation

Install via `npm install queshot`

## CouchDB View Setup

You need to create a view which a queue will use to poll for inactive jobs. This view should emit the document as value and an array [queue_name, created_at] as key. Canonically:

```
function (doc) {
  if (doc.state === 'inactive') {
     emit([doc.queues, doc.created_at], doc);
  }
}
```

## Example Usage

```
var Q = require('queshot'),
	C = require('cradle');

var q = Q.createQueue('my queue', new C.Connection());

q.createWorker('my worker', 2, function (job, done) {
	console.log('working on ' + job);
	done();
}).wakeUp();

setInterval(function () {

	q.createJob({custom: 'data', like: 'that'}, function (err, job) {
		if (err) return console.log(err);
		console.log('created ' + job);
	});

}, 1000);
```

## Queue Reference

### Creation

Create a queue via `queshot.createQueue(name, couch[, config])` with a name and a valid Cradle connection.

Possible config options:

- `limit`: How many jobs to poll at once. If high, will increase poll roundtrip time, if low, will increase number of conflicts.
- `view`: Name of the couchdb view to use.
- `autoremove`: Automatically remove jobs after a worker finished them successfully (failed jobs persist).
- `writeonly`: Use this queue just to create jobs, not to create workers (will prevent the queue from subscribing to the changes stream)

### Creating Jobs

Create a new job via `queue.createJob(data, cb)`. `data` can be any custom data you want to attach to the job. `cb` is a callback that will be called like `cb(error, jobid)`.

### Querying Jobs

- `queue.jobExists(jobid)`: returns `true` if a job exists in the local working stage of the queue, `false` otherwise.
- `queue.getJobData(jobid, data, cb)`: gets the custom job data. callback is called like `cb(err)`.

### Updating Jobs

- `queue.setJobState(jobid, state, cb)`: set the job state.
- `queue.logJob(jobid, logline, cb)`: appends `logline` to the job log.
- `queue.progressJob(jobid, progress, cb)`: sets the jobs progress.
- `queue.setJobData(jobid, data, cb)`: sets the custom job data.

## Worker Reference

### Creation

To create a worker, you need a Queue object set up. Then, initialize a worker via `worker = queue.createWorker(name, limit, fn)`. `name` is a name you give the worker to uniquely identify it in logs and job fetching operations. `limit` specifies the number of concurrent worker threads that are allowed to run at one time. `fn` is your worker function that accepts two parameters, the jobid and a callback function.

### Managing Runtime

- `worker.wakeUp()` wakes up the worker and it starts to poll for jobs if not paused. This method returns `this` to enable chaining.
- `worker.goToSleep()` stops the polling for jobs. This doesn't pause the worker, it just stops to actively query for jobs. Jobs coming in via the changes stream will still be accepted.
- `worker.pause()` pauses the worker. This stops the worker from accepting new jobs.
- `worker.resume()` revokes the pause of the worker.