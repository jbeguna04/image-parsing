const Quagga = require('quagga').default

const fs = require('fs')
// const path = require('path')
const brain = require('brain.js')
const sharp = require('sharp')
const fastGlob = require('fast-glob')
const Store = require('electron-store')

// const utilities = require('../../../utilities/utilities')

const store = new Store()
const options = store.get('options')

async function getDesignData() {
  const designData = {
    questions: {}
  }
  const rollNoPattern = new RegExp(/rollnobarcode/gi)
  const questionPattern = new RegExp(/(q[1-9][0-9]?[ad])\b/gi) // Match roll and questions options a & d

  const container = document.createElement('div')
  container.innerHTML = fs.readFileSync(options.train.source.designFile, 'utf8')
  const svg = container.getElementsByTagName('svg')[0]
  const groups = svg.getElementsByTagName('g')

  designData.width = Math.ceil(svg.viewBox.baseVal.width)
  designData.height = Math.ceil(svg.viewBox.baseVal.height)

  let transform
  let x
  let y
  let width
  let height
  let optionTitle
  let QuestionNumber

  for (let i = 0; i < groups.length; i += 1) {
    const group = groups[i]
    const title = group
      .getElementsByTagName('title')[0]
      .innerHTML.trim()
      .toLowerCase()

    if (questionPattern.test(title)) {
      transform = group
        .getAttribute('transform')
        .replace(/(translate)|\(|\)/gi, '')
        .split(',')
        .map(item => parseInt(item, 10))

      x = parseInt(group.getElementsByTagName('rect')[0].getAttribute('x'), 10)
      y = parseInt(group.getElementsByTagName('rect')[0].getAttribute('y'), 10)

      x += transform[0]
      y += transform[1]

      width = parseInt(
        group.getElementsByTagName('rect')[0].getAttribute('width'),
        10
      )
      height = parseInt(
        group.getElementsByTagName('rect')[0].getAttribute('height'),
        10
      )

      optionTitle = title.slice(-1)
      QuestionNumber = title.slice(0, -1)

      if (!designData.questions[QuestionNumber]) {
        designData.questions[QuestionNumber] = {}
      }

      if (optionTitle === 'a') {
        designData.questions[QuestionNumber].x1 = x
        designData.questions[QuestionNumber].y1 = y
      } else {
        designData.questions[QuestionNumber].x2 = x + width
        designData.questions[QuestionNumber].y2 = y + height
      }
    } else if (rollNoPattern.test(title)) {
      transform = group
        .getAttribute('transform')
        .replace(/(translate)|\(|\)/gi, '')
        .split(',')
        .map(item => parseInt(item, 10))

      x = parseInt(group.getElementsByTagName('rect')[0].getAttribute('x'), 10)
      y = parseInt(group.getElementsByTagName('rect')[0].getAttribute('y'), 10)

      x += transform[0]
      y += transform[1]

      width = parseInt(
        group.getElementsByTagName('rect')[0].getAttribute('width'),
        10
      )
      height = parseInt(
        group.getElementsByTagName('rect')[0].getAttribute('height'),
        10
      )

      designData.rollNo = {
        x1: x,
        y1: y,
        x2: x + width,
        y2: y + height
      }
    }
  }

  return designData
}

// get Images
function getImagePaths() {
  return fastGlob(
    `${options.train.source.image}/*.{${options.validFormats.image.join(',')}}`,
    {
      onlyFiles: true
    }
  )
}

// Load results csv
async function getResultData() {
  const resultsData = {}
  const resultFile = fs.readFileSync(options.train.source.excelFile, 'utf8')

  const rows = resultFile.split('\n')
  const headerValues = rows[0].split(',').map(word => word.toLowerCase())
  const rollNoIndex =
    headerValues.indexOf('rollno') ||
    headerValues.indexOf('rollnumber') ||
    headerValues.indexOf('rollno.') ||
    headerValues.indexOf('roll no') ||
    headerValues.indexOf('roll number')

  let values
  let obj

  for (let i = 1; i < rows.length; i += 1) {
    values = rows[i].split(',').map(word => word.toLowerCase())
    obj = {}

    // eslint-disable-next-line
    if (values.length <= 60) continue

    for (let j = 0; j < values.length; j += 1) {
      obj[headerValues[j]] = values[j] === '?' ? 'empty' : values[j]
    }

    resultsData[values[rollNoIndex]] = obj
  }

  return resultsData
}

async function getRollNoFromImageBuffer(path, designData) {
  const img = sharp(path)
    .png()
    .flatten()
    .toColourspace('b-w')
    .threshold(32)
  const rollNoPos = designData.rollNo

  // extract meta data
  const metadata = await img.metadata()
  const ratio = metadata.width / designData.width

  return new Promise((resolve, reject) => {
    // prepre buffer for barcode scanner
    img
      .extract({
        left: Math.ceil(rollNoPos.x1 * ratio),
        top: Math.ceil(rollNoPos.y1 * ratio),
        width: Math.ceil((rollNoPos.x2 - rollNoPos.x1) * ratio),
        height: Math.ceil((rollNoPos.y2 - rollNoPos.y1) * ratio)
      })
      .toBuffer()
      .then(buff => {
        Quagga.decodeSingle(
          {
            decoder: {
              multiple: false,
              readers: ['code_39_reader']
            },
            locate: false,
            locator: {
              halfSample: true,
              patchSize: 'medium'
            },
            numOfWorkers: 0,
            src: `data:image/png;base64,${buff.toString('base64')}`
          },
          result => {
            if (result.codeResult) {
              resolve(result.codeResult.code)
            } else {
              reject(new Error('Unable to read barcode'))
            }
          }
        )
      })
  })
}

async function prepareTrainingData(designData, resultsData, path, rollNo) {
  return new Promise((resolve, reject) => {
    const promises = []
    const img = sharp(path)
      .resize(designData.width)
      .max()
      .raw()
      .toColourspace('b-w')
      .threshold(32)

    // extract all questions portions
    Object.keys(designData.questions).forEach(title => {
      const p = new Promise((resolve, reject) => {
        const q = designData.questions[title]

        img
          .extract({
            left: q.x1 - 10,
            top: q.y1 - 10,
            width: q.x2 - q.x1 + 10,
            height: q.y2 - q.y1 + 10
          })
          /*
          .toFile(`${global.__paths.tmp}\\${rollNo}-${title}.png`, err => {
            if (err) console.log(err)
          })
          */
          .toBuffer()
          .then(buff => {
            const data = buff.toJSON().data.map(val => (val === 0 ? 1 : 0))

            console.log(data.length)

            if (resultsData[rollNo] && resultsData[rollNo][title] !== '*') {
              const o = {}
              o[resultsData[rollNo][title]] = 1

              resolve({
                input: data,
                output: o
              })
            } else {
              resolve(false)
            }
          })
      })

      promises.push(p)
    })

    Promise.all(promises).then(res => {
      resolve({
        rollNo,
        data: res
      })
    })
  })
}

module.exports = {
  async train(opt) {
    Promise.all([getDesignData(), getResultData(), getImagePaths()]).then(
      async res => {
        const [designData, resultsData, paths] = res
        const promises = []

        // eslint-disable-next-line
        for (const path of paths) {
          const rollNo = await getRollNoFromImageBuffer(path, designData)

          if (rollNo) {
            const p = prepareTrainingData(designData, resultsData, path, rollNo)

            promises.push(p)
          } else {
            console.log('\nError: unable to read barcode from the file: ', path)
          }
        }

        Promise.all(promises).then(results => {
          const trainingData = []
          const net = new brain.NeuralNetwork()

          results.forEach(result => {
            result.data.forEach(data => {
              if (data) {
                trainingData.push({
                  input: data.input,
                  output: data.output
                })
              }
            })
          })

          console.log('Starting training...')

          const result = net.train(trainingData, {
            // iterations: 500,
            // errorThresh: 0.0001,
            log: true,
            logPeriod: 1
            // activation: 'leaky-relu'
          })

          fs.writeFileSync(
            `${global.__paths.trainingData}\\data.json`,
            JSON.stringify(net.toJSON())
          )

          console.log(
            '\nTraining data exported to: ',
            `${global.__paths.trainingData} with result: \n`,
            result
          )
        })
      }
    )
  }
}
