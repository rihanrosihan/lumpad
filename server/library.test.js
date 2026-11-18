import test from 'node:test'
import assert from 'node:assert/strict'
process.env.DATA_DIR = (await import('node:fs')).mkdtempSync((await import('node:os')).tmpdir() + '/lib-')
const { add, safeUrl, list } = await import('./library.js')

test('only http(s) links are stored', () => {
  assert.equal(safeUrl('https://pubmed.ncbi.nlm.nih.gov/26423706/'), 'https://pubmed.ncbi.nlm.nih.gov/26423706/')
  for (const bad of ['javascript:alert(1)', 'data:text/html,<script>1</script>', 'JaVaScRiPt:alert(1)', '//evil.com', 'ftp://x', 'https://a b', 'https://x"onmouseover=1', '']) assert.equal(safeUrl(bad), '', bad)
  add({ title: 'x', url: 'javascript:alert(1)' }); assert.equal(list()[0].url, '')
})
