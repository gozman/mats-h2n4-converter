const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('node:path')
const fs = require('fs')
const readline = require('readline')

const createWindow = () => {
    const win = new BrowserWindow({
      width: 800,
      height: 600,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js')
      }
    })
  
    win.loadFile('index.html')
  }

  app.whenReady().then(() => {
    createWindow()

    ipcMain.on('select-file', async (event) => {
      const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openFile']
      });

      if (canceled || filePaths.length === 0) {
        console.log('No file selected');
        return;
      }

      const filePath = filePaths[0];
      console.log('File selected:', filePath);

      const readStream = fs.createReadStream(filePath, { encoding: 'utf-8' });
      const rl = readline.createInterface({ input: readStream });

      // Determine the output file path
      const outputFilePath = filePath.replace(/(\.[^/.]+)$/, '-H2N4$1');
      const writeStream = fs.createWriteStream(outputFilePath, { encoding: 'utf-8' });

      let currentHand = [];
      let handNumber = 0;

      rl.on('line', (line) => {
        if (line.startsWith('PokerStars Zoom Hand')) {
          if (currentHand.length > 0) {
            const convertedHand = convertHand(currentHand, handNumber);
            writeStream.write(convertedHand + '\n\n\n\n'); // Add 4 newlines
            currentHand = [];
            handNumber++;
            event.sender.send('update-progress', handNumber);
          }
        }
        currentHand.push(line);
      });

      rl.on('close', () => {
        if (currentHand.length > 0) {
          const convertedHand = convertHand(currentHand, handNumber);
          writeStream.write(convertedHand + '\n\n\n\n'); // Add 4 newlines
          handNumber++;
          event.sender.send('update-progress', handNumber);
        }

        writeStream.end(() => {
          console.log(`File successfully converted and saved as ${outputFilePath}`);
          event.sender.send('conversion-done', outputFilePath, handNumber);
        });
      });

      writeStream.on('error', (err) => {
        console.error('An error occurred writing the file:', err);
      });
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  });


  function convertHand(handLines, handNumber) {
    let handContent = ''; // To collect the hand content after initial processing
    const seatsInfo = {}; // Maps output seat numbers to { playerName, stackSize, position }
    const playerPositionMap = {}; // Maps player names to their positions
    let buttonSeatInput = 0; // Input seat number of the button
    let buttonSeatOutput = 0; // Output seat number of the button
    let isFirstLine = true;
    let inSummarySection = false;
    let summaryLines = [];
    let actionLines = [];
    let potInfo = '';
    let boardLine = '';
    let smallBlindPlayer = '';
    let bigBlindPlayer = '';

    // Map input seat numbers to output seat numbers
    const seatConversionMap = {
        1: 6, // Input seat 1 becomes output seat 6
        2: 1,
        3: 2,
        4: 3,
        5: 4,
        6: 5
    };

    // Positions in order after blinds and button
    const positionOrder = ['Pio_EP', 'Pio_MP', 'Pio_CO'];

    handLines.forEach((line) => {
        if (isFirstLine) {
            // Include the first line as is
            handContent += line + '\n';
            isFirstLine = false;
        } else if (line.startsWith('Table')) {
            const match = line.match(/Seat #(\d+) is the button/);
            if (match) {
                buttonSeatInput = parseInt(match[1], 10);
                buttonSeatOutput = seatConversionMap[buttonSeatInput];
            }
            handContent += `Table 'PioSolver Table' 6-max Seat #${buttonSeatOutput} is the button\n`;
        } else if (line.startsWith('Seat') && !inSummarySection) {
            const match = line.match(/Seat (\d+): (\S+)(.+)/);
            if (match) {
                const inputSeatNumber = parseInt(match[1], 10);
                const outputSeatNumber = seatConversionMap[inputSeatNumber];
                const playerName = match[2];
                const restOfLine = match[3];

                // Extract stack size
                const stackMatch = restOfLine.match(/\((.+) in chips\)/);
                const stackSize = stackMatch ? stackMatch[1] : '$0.00';

                seatsInfo[outputSeatNumber] = {
                    playerName,
                    stackSize,
                    inputSeatNumber
                };
            }
        } else if (line.includes('posts small blind')) {
            const match = line.match(/(\S+): posts small blind \$(\d+(\.\d+)?)/);
            if (match) {
                smallBlindPlayer = match[1];
            }
            actionLines.push(line);
        } else if (line.includes('posts big blind')) {
            const match = line.match(/(\S+): posts big blind \$(\d+(\.\d+)?)/);
            if (match) {
                bigBlindPlayer = match[1];
            }
            actionLines.push(line);
        } else if (line.startsWith('*** SUMMARY ***')) {
            inSummarySection = true;
        } else if (inSummarySection) {
            if (line.startsWith('Total pot')) {
                potInfo = line;
            } else if (line.startsWith('Board')) {
                boardLine = line;
            } else if (line.startsWith('Seat')) {
                summaryLines.push(line);
            }
        } else {
            // Collect action and other lines
            actionLines.push(line);
        }
    });

    // Assign positions to players based on their roles
    for (let seatNum = 1; seatNum <= 6; seatNum++) {
        if (seatsInfo[seatNum]) {
            const seatInfo = seatsInfo[seatNum];
            const playerName = seatInfo.playerName;

            if (seatNum === buttonSeatOutput) {
                seatInfo.position = 'Pio_BTN';
            } else if (playerName === smallBlindPlayer) {
                seatInfo.position = 'Pio_OOP';
            } else if (playerName === bigBlindPlayer) {
                seatInfo.position = 'Pio_IP';
            } else {
                // Assign positions to remaining players in order
                seatInfo.position = null; // Placeholder
            }
        }
    }

    // Assign positions to remaining players (EP, MP, CO)
    let remainingPositions = positionOrder.slice();
    for (let seatNum = 1; seatNum <= 6; seatNum++) {
        if (seatsInfo[seatNum]) {
            const seatInfo = seatsInfo[seatNum];
            if (!seatInfo.position) {
                seatInfo.position = remainingPositions.shift();
            }
            playerPositionMap[seatInfo.playerName] = seatInfo.position;
        }
    }

    // Build seat lines without role annotations
    for (let seatNum = 1; seatNum <= 6; seatNum++) {
        if (seatsInfo[seatNum]) {
            const { position, stackSize } = seatsInfo[seatNum];
            handContent += `Seat ${seatNum}: ${position} (${stackSize} in chips)\n`;
        }
    }

    // Replace player names with positions in action lines
    actionLines = actionLines.map((line) => {
        // Replace occurrences of player names with their positions
        for (const [playerName, position] of Object.entries(playerPositionMap)) {
            const regex = new RegExp(`\\b${playerName}\\b`, 'g');
            line = line.replace(regex, position);
        }
        return line;
    });

    // Append action lines
    actionLines.forEach((line) => {
        handContent += line + '\n';
    });

    // Process summary section
    if (summaryLines.length > 0) {
        handContent += '*** SUMMARY ***\n';

        // Output pot info and board after *** SUMMARY *** and before seat specifics
        if (potInfo) handContent += potInfo + '\n';
        if (boardLine) handContent += boardLine + '\n';

        // Re-map and sort the summary seat lines
        const remappedSummaries = [];
        summaryLines.forEach((line) => {
            const match = line.match(/Seat (\d+): (\S+)(.*)/);
            if (match) {
                const inputSeatNumber = parseInt(match[1], 10);
                const outputSeatNumber = seatConversionMap[inputSeatNumber];
                const playerName = match[2];
                let restOfLine = match[3];
                const position = seatsInfo[outputSeatNumber].position;

                // Remove any existing role annotations
                restOfLine = restOfLine.replace(/\s*\(button\)/g, '')
                                       .replace(/\s*\(small blind\)/g, '')
                                       .replace(/\s*\(big blind\)/g, '');

                remappedSummaries.push({
                    seatNum: outputSeatNumber,
                    playerName,
                    position,
                    restOfLine
                });
            }
        });

        // Sort seat summaries by seat number
        remappedSummaries.sort((a, b) => a.seatNum - b.seatNum);

        remappedSummaries.forEach((item) => {
            const { seatNum, position, restOfLine } = item;
            const seatNumber = parseInt(seatNum, 10);
            const btnText = (seatNumber === buttonSeatOutput) ? ' (button)' : '';
            let blindText = '';
            if (position === 'Pio_OOP') blindText = ' (small blind)';
            else if (position === 'Pio_IP') blindText = ' (big blind)';

            handContent += `Seat ${seatNum}: ${position}${btnText}${blindText}${restOfLine}\n`;
        });
    }

    // Replace player names with positions in the rest of the content
    handContent = handContent.replace(/\b(\S+):/g, (match, playerName) => {
        const position = playerPositionMap[playerName];
        return position ? `${position}:` : match;
    });

    // Adjust for "collected $X from pot" and "collected $X from the pot"
    handContent = handContent.replace(/(\b\S+\b) collected \$[\d.]+ from( the)? pot/g, (match, playerName) => {
        const position = playerPositionMap[playerName];
        return position ? match.replace(playerName, position) : match;
    });

    // Replace player names in "shows" lines
    handContent = handContent.replace(/(\b\S+\b) shows/g, (match, playerName) => {
        const position = playerPositionMap[playerName];
        return position ? `${position} shows` : match;
    });

    return handContent + '\n';
}
