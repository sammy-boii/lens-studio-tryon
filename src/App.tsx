import { useEffect, useRef, useState } from 'react'
import {
  bootstrapCameraKit,
  createMediaStreamSource,
  Transform2D,
  type CameraKitSession,
  type Lens
} from '@snap/camera-kit'
import './App.css'

const apiToken = import.meta.env.VITE_API_TOKEN
const lensId = import.meta.env.VITE_LENS_ID
const lensGroupId = import.meta.env.VITE_LENS_GROUP_ID
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:3000'

const videoConstraints: MediaTrackConstraints = {
  facingMode: 'user',
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 30, max: 30 }
}

type Status = 'idle' | 'starting' | 'ready' | 'error'
type ProcessingStatus = 'idle' | 'uploading' | 'processing' | 'ready' | 'error'
type CameraKitInstance = Awaited<ReturnType<typeof bootstrapCameraKit>>

const statusLabels: Record<Status, string> = {
  idle: 'Idle',
  starting: 'Starting',
  ready: 'Live',
  error: 'Error'
}

const processingLabels: Record<ProcessingStatus, string> = {
  idle: '',
  uploading: 'Uploading...',
  processing: 'Removing background...',
  ready: 'Texture ready',
  error: 'Processing failed'
}

function formatError(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Unknown error'
}

function formatBytes(bytes: number | null) {
  if (bytes === null) return ''
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  const mb = kb / 1024
  return `${mb.toFixed(1)} MB`
}

function App() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const sessionRef = useRef<CameraKitSession | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const cameraKitRef = useRef<CameraKitInstance | null>(null)
  const lensRef = useRef<Lens | null>(null)
  const mountedRef = useRef(true)
  const processedTextureUrlRef = useRef<string | null>(null)

  const [status, setStatus] = useState<Status>('idle')
  const [processingStatus, setProcessingStatus] =
    useState<ProcessingStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadName, setUploadName] = useState<string | null>(null)
  const [uploadSize, setUploadSize] = useState<number | null>(null)
  const [processedPreviewUrl, setProcessedPreviewUrl] = useState<string | null>(
    null
  )
  const [selectedGarment, setSelectedGarment] = useState<string>('sweatshirt')

  const cleanup = () => {
    sessionRef.current?.pause()
    sessionRef.current = null
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
    }
    streamRef.current = null
    if (containerRef.current) {
      containerRef.current.replaceChildren()
    }
  }

  const startSession = async () => {
    if (status === 'starting') return
    setStatus('starting')
    setError(null)

    if (!apiToken || !lensId || !lensGroupId) {
      setStatus('error')
      setError(
        'Missing VITE_API_TOKEN, VITE_LENS_ID, or VITE_LENS_GROUP_ID in .env'
      )
      return
    }

    if (!containerRef.current) {
      setStatus('error')
      setError('Preview container is not ready yet')
      return
    }

    try {
      cleanup()

      if (!cameraKitRef.current) {
        cameraKitRef.current = await bootstrapCameraKit({ apiToken })
      }

      const cameraKit = cameraKitRef.current
      const canvas = document.createElement('canvas')
      canvas.className = 'camera-canvas'
      containerRef.current.replaceChildren(canvas)

      const session = await cameraKit.createSession({
        liveRenderTarget: canvas
      })
      sessionRef.current = session

      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints,
        audio: false
      })
      streamRef.current = mediaStream

      const source = createMediaStreamSource(mediaStream, {
        transform: Transform2D.MirrorX,
        cameraType: 'user'
      })
      await session.setSource(source)

      const lens = await cameraKit.lensRepository.loadLens(lensId, lensGroupId)
      lensRef.current = lens

      // Apply lens — pass data directly, no launchData wrapper
      await session.applyLens(lens, {
        launchParams: {
          garment: selectedGarment,
          ...(processedTextureUrlRef.current && {
            textureUrl: processedTextureUrlRef.current
          })
        }
      })

      await session.play()

      if (mountedRef.current) setStatus('ready')
    } catch (err) {
      if (mountedRef.current) {
        setStatus('error')
        setError(formatError(err))
      }
    }
  }

  const stopSession = () => {
    cleanup()
    setStatus('idle')
  }

  const applyLensWithData = async (
    garment: string,
    textureUrl: string | null
  ) => {
    if (!sessionRef.current || !lensRef.current) return
    try {
      await sessionRef.current.applyLens(lensRef.current, {
        launchParams: {
          garment,
          ...(textureUrl && { textureUrl })
        }
      })
      console.log('Lens applied — garment:', garment, 'texture:', textureUrl)
    } catch (err) {
      console.error('Failed to apply lens:', err)
    }
  }

  const handleGarmentChange = async (value: string) => {
    setSelectedGarment(value)
    await applyLensWithData(value, processedTextureUrlRef.current)
  }

  const handleTextureUpload = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0]
    if (!file) {
      setUploadName(null)
      setUploadSize(null)
      setProcessedPreviewUrl(null)
      processedTextureUrlRef.current = null
      return
    }

    setUploadError(null)
    setProcessingStatus('uploading')
    setUploadName(file.name)
    setUploadSize(file.size)

    try {
      setProcessingStatus('processing')
      const formData = new FormData()
      formData.append('image', file)
      formData.append('garment', selectedGarment)

      const response = await fetch(`${BACKEND_URL}/process-garment`, {
        method: 'POST',
        body: formData
      })

      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || 'Backend processing failed')
      }

      const data = await response.json()
      if (!data.success || !data.texture) {
        throw new Error('Backend did not return a texture URL')
      }

      processedTextureUrlRef.current = data.texture

      // Show preview
      const imageResponse = await fetch(data.texture, {
        headers: {
          'ngrok-skip-browser-warning': 'true'
        }
      })
      const buffer = await imageResponse.arrayBuffer()
      const blob = new Blob([buffer], { type: 'image/png' })
      setProcessedPreviewUrl(URL.createObjectURL(blob))
      setProcessingStatus('ready')

      // Apply lens with new texture
      await applyLensWithData(selectedGarment, data.texture)
    } catch (err) {
      setProcessedPreviewUrl(null)
      processedTextureUrlRef.current = null
      setUploadError(formatError(err))
      setProcessingStatus('error')
    }
  }

  useEffect(() => {
    mountedRef.current = true
    startSession()
    return () => {
      mountedRef.current = false
      cleanup()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className='app'>
      <header className='topbar'>
        <div className='brand'>Lens Fitting Room</div>
        <div className={`status ${status}`}>{statusLabels[status]}</div>
      </header>

      <main className='content'>
        <section className='panel'>
          <p className='eyebrow'>Camera Kit Web MVP</p>
          <h1>Live 3D garment try-on</h1>
          <p className='lede'>
            Upload a photo of your garment. Background is removed automatically,
            then the texture is applied to the live 3D lens.
          </p>

          <div className='controls'>
            <button className='btn primary' onClick={startSession}>
              Restart camera
            </button>
            <button
              className='btn secondary'
              onClick={stopSession}
              disabled={status === 'idle' || status === 'starting'}
            >
              Stop
            </button>
          </div>

          {error && (
            <div className='error'>
              <strong>Startup issue:</strong> {error}
            </div>
          )}

          <div className='remote'>
            <div className='section-title'>Garment controls</div>

            <label className='field'>
              <span className='field-label'>Garment type</span>
              <select
                className='text-input'
                value={selectedGarment}
                onChange={(e) => handleGarmentChange(e.target.value)}
              >
                <option value='dress'>Dress</option>
                <option value='hoodie'>Hoodie</option>
                <option value='leggings'>Leggings</option>
                <option value='shorts'>Shorts</option>
                <option value='sweatshirt'>Sweatshirt</option>
                <option value='tshirt'>T-Shirt</option>
              </select>
            </label>

            <label className='field'>
              <span className='field-label'>Upload garment photo</span>
              <input
                className='file-input'
                type='file'
                accept='image/*'
                onChange={handleTextureUpload}
              />
            </label>

            {processingStatus !== 'idle' && (
              <div
                className={`upload-meta ${processingStatus === 'error' ? 'error' : ''}`}
              >
                {processingLabels[processingStatus]}
                {processingStatus === 'ready' && uploadName && (
                  <span>
                    {' '}
                    · {uploadName} · {formatBytes(uploadSize)}
                  </span>
                )}
              </div>
            )}

            {processedPreviewUrl && (
              <div className='texture-preview'>
                <span className='field-label'>Processed texture:</span>
                <img
                  src={processedPreviewUrl}
                  alt='Processed garment texture'
                  style={{
                    marginTop: 8,
                    maxWidth: '100%',
                    maxHeight: 180,
                    borderRadius: 8,
                    border: '1px solid var(--border)',
                    display: 'block'
                  }}
                />
              </div>
            )}

            {uploadError && (
              <div className='error'>
                <strong>Processing issue:</strong> {uploadError}
              </div>
            )}

            <div className='hint' style={{ marginTop: 8 }}>
              Lens updates automatically when you change garment or upload a
              photo.
            </div>
          </div>

          <div className='meta'>
            <div>
              <span className='meta-label'>Lens</span>
              <span className='meta-value'>{lensId || 'Not set'}</span>
            </div>
            <div>
              <span className='meta-label'>Group</span>
              <span className='meta-value'>{lensGroupId || 'Not set'}</span>
            </div>
          </div>
        </section>

        <section className='preview'>
          <div className='preview-inner' ref={containerRef} />
          <div className='preview-overlay'>
            <span className='overlay-pill'>Webcam</span>
            <span className='overlay-status'>
              {status === 'starting' && 'Starting camera...'}
              {status === 'error' && 'Camera failed to start'}
              {status === 'ready' && 'Lens active'}
              {status === 'idle' && 'Camera stopped'}
            </span>
          </div>
        </section>
      </main>
    </div>
  )
}

export default App
