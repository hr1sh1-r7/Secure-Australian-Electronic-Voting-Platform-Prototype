const path = require('path')
const { spawn } = require('child_process')

// Runs the independent Python Engine B as a separate process (SR-15).
// Data goes in on stdin and comes back on stdout. No shell is used, so
// nothing in the ballot data can ever be interpreted as a command.
const ENGINE_B = path.join(__dirname, '..', '..', 'tally-engine-b', 'engine_b.py')
const TIMEOUT_MS = 5 * 60 * 1000

function pythonBin() {
  return process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3')
}

function countEngineB(input) {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin(), ['-I', ENGINE_B], { stdio: ['pipe', 'pipe', 'pipe'], timeout: TIMEOUT_MS })
    const out = []
    const err = []
    child.stdout.on('data', (d) => out.push(d))
    child.stderr.on('data', (d) => err.push(d))
    child.on('error', (e) => reject(new Error(`Could not start Engine B (${pythonBin()}): ${e.message}`)))
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`Engine B failed: ${Buffer.concat(err).toString().slice(0, 300)}`))
      try {
        resolve(JSON.parse(Buffer.concat(out).toString('utf8')))
      } catch {
        reject(new Error('Engine B returned invalid JSON'))
      }
    })
    child.stdin.end(JSON.stringify(input))
  })
}

module.exports = { countEngineB }
