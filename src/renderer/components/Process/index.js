const fs = require('fs')
const brain = require('brain.js')
const sharp = require('sharp')

const utilities = require('../../../utilities/')

async function prepareTrainingData(designData, path) {
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
          .toBuffer()
          .then(buff => {
            const data = buff.toJSON().data.map(val => (val ===
              0 ? 1 : 0))

            resolve({
              title,
              data
            })
          })
      })

      promises.push(p)
    })

    Promise.all(promises).then(res => {
      resolve(res)
    })
  })
}

module.exports = {
  async process() {
    Promise.all([utilities.getDesignData(), utilities.getImagePaths()]).then(
      async res => {
        const resultsJSON = {}
        const [designData, paths] = res
        const net = new brain.NeuralNetwork()
        const trainingData = JSON.parse(
          fs.readFileSync(`${global.__paths.trainingData}\\data.json`)
        )

        console.log('\nLoading network...')
        net.fromJSON(trainingData)

        console.log('\nStarting processing...')

        // eslint-disable-next-line
        for (const path of paths) {
          const rollNo = await utilities.getRollNoFromImageBuffer(
            path,
            designData
          )
          prepareTrainingData(designData, path).then(output => {
            if (!resultsJSON[rollNo]) resultsJSON[rollNo] = {}

            output.forEach(q => {
              const pre = net.run(q.data)
              const resultArray = []

              Object.keys(pre).forEach((key, index) => {
                resultArray[index] = {
                  key,
                  val: pre[key]
                }
              })

              resultArray.sort((a, b) => b.val - a.val)
              let value = resultArray[0]

              if (value.val >= 0.95 && value.key === '?') {
                resultsJSON[rollNo][q.title] = value.key
              } else {
                const newArray = resultArray
                  .filter(item => item.key !== '?')
                  .sort((a, b) => b.val - a.val)

                value = newArray[0]

                if (newArray[1].val >= 0.5 ||
                  (newArray[0].val - newArray[1].val < 20)) {
                  resultsJSON[rollNo][q.title] = '*'
                } else {
                  resultsJSON[rollNo][q.title] = value.key.toUpperCase()
                }
              }
            })
          })
        }

        fs.writeFileSync(
          `${global.__paths.trainingData}\\data-output.json`,
          JSON.stringify(resultsJSON)
        )

        fs.writeFileSync(
          `${global.__paths.trainingData}\\data-output.csv`,
          utilities.jsonToCsv(resultsJSON)
        )

        console.log(
          '\nResult data exported to: ',
          `${global.__paths.trainingData}, Result: \n`,
          resultsJSON
        )
      }
    )
  }
}
