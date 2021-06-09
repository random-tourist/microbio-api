import { DOMParser, Element, HTMLDocument } from 'https://deno.land/x/deno_dom/deno-dom-wasm.ts'
import { serve } from "https://deno.land/x/sift/mod.ts"

const DATA_URL = 'https://lpsn.dsmz.de'

interface BacteriaIdentification {
  id: string
  name: string
}

interface BacteriaSpecification {
  id: string
  name: string
  author: string | undefined
  strain: string | undefined
  sequence_accession_no: string | undefined
  etymology: string | undefined
  refs: string[]
  synonyms: string[]
}

const getBacteriaeList = async (searchWord: string): Promise<BacteriaSpecification[]> =>
  getIdentifications(searchWord)
    .then(ids => Promise.all(ids.map(({ id, name }) => getBacteriaSpec(id, name))))

const getIdentifications = async (searchWord: string): Promise<BacteriaIdentification[]> =>
  fetch(`${DATA_URL}/search?word=${searchWord}`)
    .then((response) => response.text())
    .then((html) => {
      const doc = new DOMParser().parseFromString(html, 'text/html')
      if (!doc) {
        throw new Error('Error while parsing content')
      }
      const foundIdentifications = [...doc.querySelectorAll('a[href^="/species/"]')]
        .map((e) => {
          const id = (e as Element).attributes.href.replace('/species/', '')
          const name = e.textContent.replaceAll('"', '').trim()
          return { id, name }
        })

      return foundIdentifications
    })

const getBacteriaSpec = async (id: string, name: string): Promise<BacteriaSpecification> =>
  fetch(`${DATA_URL}/species/${id}`)
    .then((response) => response.text())
    .then((html) => {
      const doc = new DOMParser().parseFromString(html, 'text/html')
      if (!doc) {
        throw new Error('Error while parsing content')
      }

      const author = getSpecValue(doc, 'name')?.replace(new RegExp(`"?${name}"?`), '').trim()
      const strain = getSpecValue(doc, 'type strain')
      const sequence_accession_no = getSpecValue(doc, '16S rRNA gene')?.split(' ')[0]
      const etymology = getSpecValue(doc, 'etymology')
      const publications = [getSpecValue(doc, 'valid publication'), getSpecValue(doc, 'original publication')]
        .filter(p => p)
        .map(p => p as string)
      const refs = publications.concat(getRefs(doc))
        .filter((value, index, self) => self.indexOf(value) === index)
      const synonyms = getSynonyms(doc)

      return {
        id,
        name,
        author,
        strain,
        sequence_accession_no,
        etymology,
        refs,
        synonyms
      }
    })

const getSpecValue = (doc: HTMLDocument, spec: string): string | undefined => {
  const page = doc.getElementById('detail-page')
  if (!page) {
    return
  }
  const specTxt = [...page.getElementsByTagName('p')]
    .map(e => e.textContent
      .replace(/<a[^>]*><\/a>\s*/, '')
      .replaceAll(/<[^>]*>/g, '')
      .replaceAll(/\s+/g, ' ')
      .trim()
    )
    .find(s => s.toLowerCase().includes(`${spec.toLowerCase()}:`))

  if (!specTxt) {
    return
  }

  return specTxt.replace(new RegExp(`${spec}:`, 'i'), '').trim()
}

const getRefs = (doc: HTMLDocument): string[] => {
  const page = doc.getElementById('detail-page')
  if (!page) {
    return []
  }

  const notesNode = [...page.getElementsByClassName('tree-arrow-open')]
    .find(e =>
      e.getElementsByClassName('open').find(e => e.textContent.toLowerCase().includes('notes:'))
    )
  if (!notesNode) {
    return []
  }

  return [...notesNode.getElementsByTagName('li')]
    .map(e => e.textContent.replaceAll(/\s+/g, ' '))
    .flatMap(note => new RegExp('(?<=publication:).*', 'i').exec(note))
    .filter(r => r !== null)
    .map(r => (r as string).trim())
    .filter(r => r.length > 0)
}

const getSynonyms = (doc: HTMLDocument): string[] => {
  const page = doc.getElementById('detail-page')
  if (!page) {
    return []
  }

  const synoNode = [...page.getElementsByClassName('tree-arrow-open')]
    .find(e =>
      e.getElementsByClassName('open').find(e => e.textContent.toLowerCase().includes('synonyms:'))
    )
  if (!synoNode) {
    return []
  }

  const table = synoNode.getElementsByTagName('tbody')[0]
  if (!table) {
    return []
  }

  return [...table.getElementsByTagName('tr')]
    .map(e => e
      .getElementsByTagName('a')[0]
      .textContent
      .replaceAll(/<[^>]*>/g, '')
      .trim()
    )
    .filter(s => s.length > 0)
}

console.log('Server started.')
serve({
  "/bateriae": async (request) => {
    const fullUrl = `https://${request.headers.get('host')}${request.url}`
    const searchParams = new URLSearchParams(new URL(fullUrl).search)
    const word = searchParams.get("word") ?? ''

    const resp = await getBacteriaeList(word).catch(console.error)
    
    return new Response(JSON.stringify(resp))
  },
  404: () => new Response("not found"),
})
