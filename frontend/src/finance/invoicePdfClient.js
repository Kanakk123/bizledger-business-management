export async function fetchInvoicePdf(invoiceId, apiUrl = '', fetchImpl = fetch) {
  const base = apiUrl.replace(/\/$/, '')
  const response = await fetchImpl(`${base}/api/invoices/${encodeURIComponent(invoiceId)}/pdf`, { credentials: 'include' })
  if (!response.ok) throw new Error('Could not download this invoice PDF.')

  const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  if (contentType !== 'application/pdf') throw new Error('The server did not return an invoice PDF.')

  const blob = await response.blob()
  if (!blob.size || (await blob.slice(0, 5).text()) !== '%PDF-') {
    throw new Error('The invoice PDF is empty or invalid.')
  }
  return blob
}
