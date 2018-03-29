const fs = require('fs')
const path = require('path')
const brain = require('brain.js')
const sharp = require('sharp')

const dataPaths = require('./data-paths')
const utilities = require('./utilities.js')

const net = new brain.recurrent.RNN()
const dirs = fs.readdirSync(dataPaths.sampleSimple)
const trainingData = []

/**
 *
 *
 * @param {any} imgPath Path to the image file
 * @param {any} option output for the image
 * @returns Raw data array of size width x height
 */
async function getDataFromImage(imgPath, option) {
  const img = sharp(imgPath)
    // .resize(96, 28)
    .toColourspace('b-w')
    .threshold(32)

  const buff = await img.raw().toBuffer()
  const data = buff
    .toJSON()
    .data.join('')
    .replace(/255/g, '1')
    .split('')

  /*
  img
    .toFormat('png')
    .toFile(path.join(dataPaths.test, 'tmp', `${Math.random()}.png`), err => {
      if (err) console.error('Error writing file: ', err)
    })
  */

  return {
    data,
    option
  }
}

/**
 * Initiates the learning process
 *
 */
function startTraining() {
  console.log('\nTraining started...\n')

  const startTime = utilities.clock()

  const result = net.train(trainingData, {
    iterations: 1000,
    log: true,
    logPeriod: 100,
    activation: 'leaky-relu'
  })

  const duration = utilities.clock(startTime)

  console.log(
    `\nTraining finished in ${duration / 1000}s with error: ${result.error}`
  )

  fs.writeFileSync(dataPaths.trainingOutput, JSON.stringify(net.toJSON()))

  console.log('\nTraining data exported to: ', dataPaths.trainingOutput)
}

/**
 * Prepares/pre-process image data for for input
 *
 */
function processData() {
  const promises = []
  console.log('\nPreparing training data...')

  dirs.forEach(dir => {
    const dirPath = path.join(dataPaths.sampleSimple, dir)
    const subDirs = fs.readdirSync(dirPath)

    subDirs.forEach(option => {
      const filePath = path.join(dirPath, option)

      promises.push(getDataFromImage(filePath, dir))
    })
  })

  Promise.all(promises).then(res => {
    for (let i = 0; i < res.length; i += 1) {
      const item = res[i]

      trainingData.push({
        input: [...item.data],
        output: [item.option]
      })
    }

    // console.log(trainingData)

    startTraining()
  })
}

// Starts process
processData()
