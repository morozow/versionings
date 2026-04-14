function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  return value.toFixed(1) + ' ' + units[unitIndex];
}

document.getElementById('btn-version').addEventListener('click', async () => {
  const version = await window.electronAPI.getVersion();
  document.getElementById('app-version').textContent = 'v' + version;
});

document.getElementById('btn-sysinfo').addEventListener('click', async () => {
  const info = await window.electronAPI.getSystemInfo();

  document.getElementById('info-platform').textContent = info.platform;
  document.getElementById('info-arch').textContent = info.arch;
  document.getElementById('info-mem-total').textContent = formatBytes(info.memory.total);
  document.getElementById('info-mem-free').textContent = formatBytes(info.memory.free);
});
