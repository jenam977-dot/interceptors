// @vitest-environment happy-dom
import { XMLHttpRequestInterceptor } from '@mswjs/interceptors/XMLHttpRequest'
import { waitForXMLHttpRequest } from '#/test/setup/helpers-neutral'

const interceptor = new XMLHttpRequestInterceptor()

beforeAll(() => {
  interceptor.apply()
})

afterEach(() => {
  interceptor.removeAllListeners()
})

afterAll(() => {
  interceptor.dispose()
})

type ProgressRecord = {
  loaded: number
  total: number
  lengthComputable: boolean
}

function spyOnProgress(target: XMLHttpRequest | XMLHttpRequestUpload) {
  const events: Array<[string, ProgressRecord]> = []

  const record = (name: string) => (event: Event) => {
    const progressEvent = event as ProgressEvent
    events.push([
      name,
      {
        loaded: progressEvent.loaded,
        total: progressEvent.total,
        lengthComputable: progressEvent.lengthComputable,
      },
    ])
  }

  for (const name of ['loadstart', 'progress', 'load', 'loadend'] as const) {
    target.addEventListener(name, record(name))
  }

  return { events }
}

it('reports lengthComputable: true when the request and response lengths are known', async ({
  task,
}) => {
  interceptor.on('request', ({ controller }) => {
    controller.respondWith(
      new Response('hello world', {
        headers: { 'content-length': '11' },
      })
    )
  })

  const request = new XMLHttpRequest()
  const { events: uploadEvents } = spyOnProgress(request.upload)
  const { events } = spyOnProgress(request)
  request.open('POST', '/resource')
  request.send('hello world')

  await waitForXMLHttpRequest(request)

  expect.soft(request.responseText).toBe('hello world')

  if (task.file.projectName === 'browser') {
    expect(uploadEvents).toEqual([
      ['loadstart', { loaded: 0, total: 11, lengthComputable: true }],
      ['progress', { loaded: 11, total: 11, lengthComputable: true }],
      ['load', { loaded: 11, total: 11, lengthComputable: true }],
      ['loadend', { loaded: 11, total: 11, lengthComputable: true }],
    ])

    // Skip the "progress" event: whether it fires for a small response
    // depends on chunk timing (see the 60ms buffering in the controller).
    expect(events.filter(([name]) => name !== 'progress')).toEqual([
      ['loadstart', { loaded: 0, total: 0, lengthComputable: true }],
      ['load', { loaded: 11, total: 11, lengthComputable: true }],
      ['loadend', { loaded: 11, total: 11, lengthComputable: true }],
    ])
  }
})

it('reports lengthComputable: false for response events when the response has no content-length', async ({
  task,
}) => {
  interceptor.on('request', ({ controller }) => {
    // No "content-length" header: the total response length is unknown
    // (e.g. a streamed response body).
    controller.respondWith(new Response('hello world'))
  })

  const request = new XMLHttpRequest()
  const { events } = spyOnProgress(request)
  request.open('GET', '/resource')
  request.send()

  await waitForXMLHttpRequest(request)

  expect.soft(request.responseText).toBe('hello world')

  if (task.file.projectName === 'browser') {
    expect(events.filter(([name]) => name !== 'progress')).toEqual([
      ['loadstart', { loaded: 0, total: 0, lengthComputable: false }],
      ['load', { loaded: 11, total: 0, lengthComputable: false }],
      ['loadend', { loaded: 11, total: 0, lengthComputable: false }],
    ])
  }
})

it('reports lengthComputable: false for upload events when the request body length cannot be computed', async ({
  task,
}) => {
  // Happy-dom cannot send a ReadableStream request body, so this
  // scenario only runs in a real browser.
  if (task.file.projectName !== 'browser') {
    return
  }

  interceptor.on('request', ({ controller }) => {
    controller.respondWith(new Response('hello world'))
  })

  const request = new XMLHttpRequest()
  const { events: uploadEvents } = spyOnProgress(request.upload)
  request.open('POST', '/resource')
  request.send(
    new ReadableStream({
      start(controller) {
        controller.error(new Error('Failed to read the request body'))
      },
    }) as unknown as XMLHttpRequestBodyInit
  )

  await waitForXMLHttpRequest(request)

  expect.soft(request.responseText).toBe('hello world')

  expect(uploadEvents).toEqual([
    ['loadstart', { loaded: 0, total: 0, lengthComputable: false }],
    ['progress', { loaded: 0, total: 0, lengthComputable: false }],
    ['load', { loaded: 0, total: 0, lengthComputable: false }],
    ['loadend', { loaded: 0, total: 0, lengthComputable: false }],
  ])
})
