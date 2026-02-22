const fs = require('fs');
const tf = require('@tensorflow/tfjs');

async function main() {
    console.log("Loading dataset...");
    const rawData = JSON.parse(fs.readFileSync('./combined_dataset.json', 'utf8'));

    // Filter and extract unique labels
    const samples = rawData.filter(d => {
        if (!d || !d.label || !d.x || d.x.length !== 63 || typeof d.label !== 'string') return false;

        // Allowed labels are individual A-Z chars, or special multi-char actions
        const upper = d.label.toUpperCase();
        return (upper.length === 1 && upper.match(/[A-Z]/)) || upper === 'SPACE' || upper === 'BKSP';
    }).map(d => ({ label: d.label.toUpperCase(), x: d.x }));

    if (samples.length === 0) {
        console.error("No valid samples found.");
        return;
    }

    const labelsSet = new Set(samples.map(s => s.label));
    const labels = Array.from(labelsSet).sort();
    const labelToIdx = {};
    labels.forEach((l, i) => labelToIdx[l] = i);

    console.log(`Found ${samples.length} valid samples across ${labels.length} classes: ${labels.join(', ')}`);

    // Shuffle the dataset so the 20% validation split doesn't just cut off the end of the alphabet!
    tf.util.shuffle(samples);

    // Convert to tensors
    const xsData = samples.map(s => s.x);
    const ysData = samples.map(s => labelToIdx[s.label]);

    const xs = tf.tensor2d(xsData);
    const ys = tf.tensor1d(ysData, 'int32');
    const ysOneHot = tf.oneHot(ys, labels.length);

    // Build the model (matching your Python architecture)
    const model = tf.sequential();
    model.add(tf.layers.dense({ units: 128, activation: 'relu', inputShape: [63] }));
    model.add(tf.layers.dense({ units: 64, activation: 'relu' }));
    model.add(tf.layers.dense({ units: labels.length, activation: 'softmax' }));

    model.compile({
        optimizer: tf.train.adam(0.001),
        loss: 'categoricalCrossentropy',
        metrics: ['accuracy']
    });

    console.log("Training model...");
    await model.fit(xs, ysOneHot, {
        epochs: 100,
        batchSize: 32,
        validationSplit: 0.2, // Use 20% for validation
        callbacks: {
            onEpochEnd: (epoch, logs) => {
                if (epoch % 10 === 0) {
                    console.log(`Epoch ${epoch}: loss = ${logs.loss.toFixed(4)}, acc = ${logs.acc.toFixed(4)}, val_acc = ${logs.val_acc.toFixed(4)}`);
                }
            }
        }
    });

    console.log("Evaluating...");
    const evalResult = await model.evaluate(xs, ysOneHot);
    console.log(`Final accuracy on all data: ${evalResult[1].dataSync()[0].toFixed(4)}`);

    // Export weights in the exact format the Chrome extension expects
    console.log("Exporting to models/asl_mlp_weights.json...");

    const denseLayers = model.layers.filter(l => l.getClassName() === 'Dense');
    const exportLayers = [];

    for (const layer of denseLayers) {
        const weights = await layer.getWeights()[0].array();
        const biases = await layer.getWeights()[1].array();

        // Determine activation string safely
        let activationName = 'linear';
        if (layer.activation && layer.activation.getClassName) {
            let cls = layer.activation.getClassName().toLowerCase();
            if (cls.includes('relu')) activationName = 'relu';
        } else {
            // fallback manual checks
            if (layer.iterations === 128 || layer.units === 64) activationName = 'relu';
        }

        exportLayers.push({
            name: layer.name,
            input_size: weights.length, // number of input nodes
            output_size: biases.length, // number of output nodes
            activation: activationName,
            weights: weights,
            biases: biases
        });
    }

    const payload = {
        model_type: "mlp",
        input_size: 63,
        labels: labels,
        layers: exportLayers
    };

    if (!fs.existsSync('./src/models')) {
        fs.mkdirSync('./src/models', { recursive: true });
    }
    fs.writeFileSync('./src/models/asl_mlp_weights.json', JSON.stringify(payload));
    console.log("Export complete! You can now run 'npm run build:chrome'");
}

main().catch(console.error);
