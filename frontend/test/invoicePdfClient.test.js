import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchInvoicePdf } from '../src/finance/invoicePdfClient.js'

const pdfResponse = (bytes = '%PDF-1.4\ninvoice content') => new Response(new Blob([bytes], { type: 'application/pdf' }), {
  status: 200,
  headers: { 'content-type': 'application/pdf; charset=binary' },
})

test('requests the selected invoice PDF with session credentials and accepts valid PDF bytes', async () => {
  let request
  const blob = await fetchInvoicePdf('sales/42', 'https://api.example.test/', async (...args) => {
    request = args
    return pdfResponse()
  })
  assert.equal(request[0], 'https://api.example.test/api/invoices/sales%2F42/pdf')
  assert.deepEqual(request[1], { credentials: 'include' })
  assert.ok(blob.type.startsWith('application/pdf'))
})

test('rejects error, non-PDF, and blank PDF responses', async () => {
  await assert.rejects(fetchInvoicePdf(1, '', async () => new Response(null, { status: 401 })), /Could not download/)
  await assert.rejects(fetchInvoicePdf(1, '', async () => new Response('{}', { headers: { 'content-type': 'application/json' } })), /did not return/)
  await assert.rejects(fetchInvoicePdf(1, '', async () => pdfResponse('')), /empty or invalid/)
  await assert.rejects(fetchInvoicePdf(1, '', async () => pdfResponse('not a PDF')), /empty or invalid/)
})
