// const fs = require('fs')
const os = require('os')

/**
 * Import utilty functions
 */
const {
  getDesignData,
  getImagePaths,
  getNeuralNet,
  getRollNoFromImage,
  getQuestionsData,
  // readJsonToCsv,
} = require('./index')

/**
 *
 * @param {Object} designData A JSON Object containing information about the position, width, height of elements in svg design file (available from utiltities/getDesignData)
 * @param {Array.<String>} imagePaths List of scanned images paths
 * @param {Function} neuralNet Trained neural network function (available from utiltities/getneuralNet)
 *
 * @returns {Object} Compiled result JSON
 */
async function processTask(designData, imagePaths, neuralNet) {
  const promises = []

  for (let i = 0; i < imagePaths.length; i += 1) {
    const imagePath = imagePaths[i]

    const promise = new Promise(resolve => {
      Promise.all([
        getRollNoFromImage(designData, imagePath),
        getQuestionsData(designData, imagePath),
      ]).then(res => {
        const [rollNo, questionsData] = res
        const resultsJson = {}

        if (!resultsJson[rollNo]) resultsJson[rollNo] = {}

        questionsData.forEach(q => {
          const pre = neuralNet.run(q.data)
          const resultArray = []

          Object.keys(pre).forEach((key, index) => {
            resultArray[index] = {
              key,
              val: pre[key],
            }
          })
          resultArray.sort((a, b) => b.val - a.val)

          let topKeyValue = resultArray[0]

          if (topKeyValue.val >= 0.95 && topKeyValue.key === '?') {
            resultsJson[rollNo][q.title] = topKeyValue.key
          } else {
            const newArray = resultArray.filter(item => item.key !== '?')

            // eslint-disable-next-line
            topKeyValue = newArray[0]

            if (
              topKeyValue.val < 0.5 ||
              topKeyValue.val - newArray[1].val < 20
            ) {
              resultsJson[rollNo][q.title] = '*'
            } else {
              resultsJson[rollNo][q.title] = topKeyValue.key.toUpperCase()
            }
          }
        })

        resolve(resultsJson)
      })
    })

    promises.push(promise)
  }

  return Promise.all(promises)
}

/**
 * Start processing scanned image files to get result
 *
 * @param {String} designFilePath design file path
 * @param {String} imagesDirectory scanned images directory
 * @param {String} neuralNetFilePath neuralNet file path
 * @param {String} outputPath output path
 *
 * @returns null
 */
async function process(
  designFilePath,
  imagesDirectory,
  neuralNetFilePath,
  outputPath
) {
  const [designData, imagePaths, neuralNet] = await Promise.all([
    getDesignData(designFilePath),
    getImagePaths(imagesDirectory),
    getNeuralNet(neuralNetFilePath),
  ])

  const TOTAL_IMAGES = imagePaths.length
  const NO_OF_CORES = Math.min(os.cpus().length * 2, TOTAL_IMAGES) // use hyper-threading

  for (let i = 0; i < NO_OF_CORES; i += 1) {
    const startIndex = Math.floor(i * (TOTAL_IMAGES / NO_OF_CORES))
    const endIndex =
      i === NO_OF_CORES - 1
        ? TOTAL_IMAGES
        : Math.ceil((i + 1) * (TOTAL_IMAGES / NO_OF_CORES))

    processTask(
      designData,
      imagePaths.slice(startIndex, endIndex),
      neuralNet
    ).then(result => {
      console.log(result[0][10023].q1, ' should be ', 'd')
    })
  }

  // fs.writeFileSync(`${outputPath}\\output.csv`, readJsonToCsv(results))
}

module.exports = {
  process,
}
