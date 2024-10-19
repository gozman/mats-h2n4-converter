const convertButton = document.getElementById('convertButton');
const handCountDiv = document.getElementById('handCount');

convertButton.addEventListener('click', () => {
  handCountDiv.textContent = 'Hands Processed: 0';
  window.electronAPI.selectFile();
});

window.electronAPI.updateProgress((progress) => {
  handCountDiv.textContent = `Hands Processed: ${progress}`;
});

window.electronAPI.conversionDone((outputPath, handCount) => {
  const emojis = ['😄', '🎉', '🤪', '😂', '🥳'];
  const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
  handCountDiv.textContent = `DONE! ${randomEmoji} Output saved to: ${outputPath}. Total hands converted: ${handCount}`;
});
