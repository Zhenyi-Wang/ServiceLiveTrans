import { spawn, type ChildProcess } from 'child_process'
import { execSync } from 'child_process'
import net from 'net'
import { existsSync } from 'fs'
import { homedir } from 'os'
import path from 'path'

export interface ServiceHealth {
  status: 'ok' | 'offline'
  available_providers?: string[]
  model_loaded?: boolean
  provider?: string
  gpu_used_mb?: number
  idle_seconds?: number
}

let childProcess: ChildProcess | null = null
let selfStarted = false
let cachedPythonPath: string | null = null

const ASR_PORT = 9900

function detectPythonPath(): string {
  if (cachedPythonPath) return cachedPythonPath

  if (process.env.ASR_PYTHON_PATH) {
    cachedPythonPath = process.env.ASR_PYTHON_PATH
    console.log(`[ASR Process] 使用 ASR_PYTHON_PATH: ${cachedPythonPath}`)
    return cachedPythonPath!
  }

  const condaPrefixes = [
    path.join(homedir(), 'miniconda3'),
    path.join(homedir(), 'anaconda3'),
    path.join(homedir(), 'miniconda'),
  ]
  const envNames = ['funasr', 'trans']
  for (const prefix of condaPrefixes) {
    for (const envName of envNames) {
      const candidate = path.join(prefix, 'envs', envName, 'bin', 'python')
      if (existsSync(candidate)) {
        cachedPythonPath = candidate
        console.log(`[ASR Process] 检测到 conda Python: ${cachedPythonPath}`)
        return cachedPythonPath!
      }
    }
  }

  try {
    const result = execSync('conda run -n funasr which python', {
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim()
    if (result) {
      cachedPythonPath = result
      console.log(`[ASR Process] 通过 conda run 检测到 Python: ${cachedPythonPath}`)
      return cachedPythonPath!
    }
  } catch {
    // conda run 失败
  }

  throw new Error('未找到 Python 环境。请设置 ASR_PYTHON_PATH 环境变量或安装 conda funasr/trans 环境。')
}

function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(true))
    server.once('listening', () => {
      server.close()
      resolve(false)
    })
    server.listen(port, '127.0.0.1')
  })
}

export async function startASRProcess(): Promise<{ pid: number } | null> {
  const portUsed = await isPortInUse(ASR_PORT)
  if (portUsed) {
    console.log(`[ASR Process] 端口 ${ASR_PORT} 已被占用，跳过启动`)
    selfStarted = false
    return null
  }

  const pythonPath = detectPythonPath()
  const projectRoot = process.cwd()

  console.log(`[ASR Process] 启动: ${pythonPath} asr/server.py`)
  childProcess = spawn(pythonPath, ['asr/server.py'], {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONPATH: projectRoot },
  })

  selfStarted = true

  childProcess.stdout?.on('data', (data: Buffer) => {
    console.log(`[ASR Process] ${data.toString().trimEnd()}`)
  })

  childProcess.stderr?.on('data', (data: Buffer) => {
    console.error(`[ASR Process] ${data.toString().trimEnd()}`)
  })

  childProcess.on('exit', (code, signal) => {
    console.log(`[ASR Process] 进程退出: code=${code}, signal=${signal}`)
    if (selfStarted && code !== 0 && code !== null) {
      console.error(`[ASR Process] ASR 服务异常退出，退出码: ${code}`)
    }
    childProcess = null
    selfStarted = false
  })

  return { pid: childProcess.pid }
}

export function stopASRProcess(): void {
  if (!selfStarted || !childProcess) {
    return
  }

  console.log(`[ASR Process] 停止进程 PID: ${childProcess.pid}`)
  childProcess.kill('SIGTERM')
  childProcess = null
  selfStarted = false
}

export async function getASRServiceHealth(): Promise<ServiceHealth> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000)

    const response = await fetch(`http://127.0.0.1:${ASR_PORT}/health`, {
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!response.ok) {
      return { status: 'offline' }
    }

    const data = await response.json()
    return { ...data, status: 'ok' }
  } catch {
    return { status: 'offline' }
  }
}

export function getProcessInfo(): { pid: number | null; selfStarted: boolean } {
  return {
    pid: childProcess?.pid ?? null,
    selfStarted,
  }
}
