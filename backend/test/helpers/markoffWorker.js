// SR-13 concurrency test worker: one "polling place" with its OWN database
// connection. All workers wait at a barrier, then try to mark off the same
// voter at the same instant.
const { workerData, parentPort } = require('worker_threads')
const Database = require('better-sqlite3')
const { createMarkOff } = require('../../services/ballotIntegrity/markoffCore')

const conn = new Database(workerData.file, { timeout: 0 }) // NOWAIT: never queue for the lock
const markOff = createMarkOff(conn)
const barrier = new Int32Array(workerData.barrier)

parentPort.postMessage('ready')
Atomics.wait(barrier, 0, 0)

let result
try {
  markOff({ voterId: workerData.voterId, terminalId: 'T-WORKER-' + workerData.n, mode: 'TOKEN_ISSUED' })
  result = 'ok'
} catch (err) {
  result = err.reason || err.code || err.message
}
conn.close()
parentPort.postMessage(result)
