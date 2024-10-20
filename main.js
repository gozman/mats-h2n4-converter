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
    let convertedHand = '';
    const seatMap = {};    // Maps player names to positions
    const seatsInfo = {};  // Maps output seat numbers to { playerName, position, stackSize }
    let buttonSeat = 0;
    let isFirstLine = true; // Indicator to track the first line
    let inSummarySection = false;
    let summaryLines = [];
    let actionLines = [];
    let potInfo = '';
    let boardLine = '';
    let smallBlindAmount = '';
    let bigBlindAmount = '';

    // Map input seat numbers to output seat numbers
    const seatConversionMap = {
        2: 1, // Input seat 2 (SB) becomes output seat 1
        3: 2, // Input seat 3 (BB) becomes output seat 2
        4: 3, // Input seat 4 (EP) becomes output seat 3
        5: 4, // Input seat 5 (MP) becomes output seat 4
        6: 5, // Input seat 6 (CO) becomes output seat 5
        1: 6  // Input seat 1 (BTN) becomes output seat 6
    };

    const positionMap = {
        1: 'Pio_OOP', // Small Blind
        2: 'Pio_IP',  // Big Blind
        3: 'Pio_EP',  // Early Position
        4: 'Pio_MP',  // Middle Position
        5: 'Pio_CO',  // Cut Off
        6: 'Pio_BTN'  // Button
    };

    handLines.forEach(line => {
        if (isFirstLine) {
            // Include the first line as is
            convertedHand += line + '\n';
            isFirstLine = false;
        } else if (line.startsWith('Table')) {
            const match = line.match(/Seat #(\d+) is the button/);
            if (match) {
                const inputButtonSeat = parseInt(match[1], 10);
                buttonSeat = seatConversionMap[inputButtonSeat];
            }
            convertedHand += `Table 'PioSolver Table' 6-max Seat #${buttonSeat} is the button\n`;
        } else if (line.startsWith('Seat') && !inSummarySection) {
            const match = line.match(/Seat (\d+): (\S+)(.+)/);
            if (match) {
                const inputSeatNumber = parseInt(match[1], 10);
                const outputSeatNumber = seatConversionMap[inputSeatNumber];
                const playerName = match[2];
                const restOfLine = match[3];
                const position = positionMap[outputSeatNumber];

                // Extract stack size
                const stackMatch = restOfLine.match(/\((.+) in chips\)/);
                const stackSize = stackMatch ? stackMatch[1] : '$0.00';

                seatMap[playerName] = position;
                seatsInfo[outputSeatNumber] = { playerName, position, stackSize };
            }
        } else if (line.includes('posts small blind')) {
            const blindMatch = line.match(/posts small blind \$(\d+\.\d+)/);
            smallBlindAmount = blindMatch ? blindMatch[1] : '0.00';
            const playerName = line.split(':')[0];
            const position = seatMap[playerName];
            actionLines.push(`${position}: posts small blind $${smallBlindAmount}`);
        } else if (line.includes('posts big blind')) {
            const blindMatch = line.match(/posts big blind \$(\d+\.\d+)/);
            bigBlindAmount = blindMatch ? blindMatch[1] : '0.00';
            const playerName = line.split(':')[0];
            const position = seatMap[playerName];
            actionLines.push(`${position}: posts big blind $${bigBlindAmount}`);
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
            // Process action lines
            const actionMatch = line.match(/^(\S+): (.+)/);
            if (actionMatch) {
                const playerName = actionMatch[1];
                const actionText = actionMatch[2];
                const position = seatMap[playerName];

                if (position) {
                    actionLines.push(`${position}: ${actionText}`);
                } else {
                    actionLines.push(line); // If position not found, include the line as is
                }
            } else if (line.startsWith('***')) {
                // Phase changes (e.g., HOLE CARDS, FLOP, TURN, RIVER)
                actionLines.push(line);
            } else if (line.includes('collected')) {
                const collectMatch = line.match(/^(\S+) collected \$(\d+\.\d+)/);
                if (collectMatch) {
                    const playerName = collectMatch[1];
                    const amount = collectMatch[2];
                    const position = seatMap[playerName];
                    if (position) {
                        actionLines.push(`${position} collected $${amount} from the pot`);
                    } else {
                        actionLines.push(line);
                    }
                }
            } else {
                // Include any other lines
                actionLines.push(line);
            }
        }
    });

    // Output seat lines in order with actual stack sizes
    for (let seatNum = 1; seatNum <= 6; seatNum++) {
        if (seatsInfo[seatNum]) {
            const { stackSize, position } = seatsInfo[seatNum];
            convertedHand += `Seat ${seatNum}: ${position} (${stackSize} in chips)\n`;
        }
    }

    // Output action lines
    actionLines.forEach(line => {
        convertedHand += line + '\n';
    });

    if (summaryLines.length > 0) {
        convertedHand += '*** SUMMARY ***\n';

        // Output pot info and board after *** SUMMARY *** and before seat specifics
        if (potInfo) convertedHand += potInfo + '\n';
        if (boardLine) convertedHand += boardLine + '\n';

        // Re-map and sort the summary seat lines
        const remappedSummaries = [];
        summaryLines.forEach(line => {
            const match = line.match(/Seat (\d+): (\S+)(.*)/);
            if (match) {
                const inputSeatNumber = parseInt(match[1], 10);
                const outputSeatNumber = seatConversionMap[inputSeatNumber];
                const playerName = match[2];
                const restOfLine = match[3];
                const position = positionMap[outputSeatNumber];
                const buttonText = (outputSeatNumber === buttonSeat) ? ' (button)' : '';

                let blindText = '';
                if (outputSeatNumber === 1) blindText = ' (small blind)';
                else if (outputSeatNumber === 2) blindText = ' (big blind)';

                // Remove duplicate role annotations in restOfLine
                let restLineClean = restOfLine.replace(/\(small blind\)\s*/g, '')
                                              .replace(/\(big blind\)\s*/g, '')
                                              .replace(/\(button\)\s*/g, '');

                remappedSummaries.push({
                    seatNum: outputSeatNumber,
                    line: `Seat ${outputSeatNumber}: ${position}${buttonText}${blindText}${restLineClean}`
                });
            }
        });

        // Sort seat summaries by seat number
        remappedSummaries.sort((a, b) => a.seatNum - b.seatNum);

        remappedSummaries.forEach(item => {
            convertedHand += item.line + '\n';
        });
    }

    return convertedHand + '\n';
}
