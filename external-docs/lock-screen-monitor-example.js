
function startMonitor() {

	if (monitor != undefined) {
		return;
	}

	changingState = false;
	outputBuffer = '';
	monitor = spawn('dbus-monitor', [`--session`, `type='signal',interface='org.gnome.ScreenSaver'`]);

	monitor.stdout.on('data', (data) => {
		outputBuffer += data.toString();
		let pos = outputBuffer.indexOf('\n');
		while (pos >= 0) {
			let m;
			let line = outputBuffer.substring(0, pos);
			outputBuffer = outputBuffer.substring(pos + 1);
			if (line.match(/member=ActiveChanged/)) {
				changingState = true;
			} else if (changingState && (m = line.match(/boolean\s+(true|false)/i))) {
				let value = (m[1].toLowerCase() == 'true');
				changingState = false;
				updateState({ lock: value });
			} else {
				changingState = false;
			}
			pos = outputBuffer.indexOf('\n');
		}
	});

	monitor.stderr.on('data', (data) => {
	});

	monitor.on('close', (code) => {
		console.log(`child process exited with code ${code}`);
	});

	updateState({ lock: false });
}
