// Excel serial numbers → ISO date / HH:MM (kept separate from the zip reader so the importer can load that lazily)
export const serialToISO = (n) => (typeof n === 'number' && n > 20000 && n < 80000 ? new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 864e5).toISOString().slice(0, 10) : null)
export const serialToHM = (n) => { if (typeof n !== 'number' || n < 0 || n >= 1.0001) return null; const m = Math.round(n * 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}` }
