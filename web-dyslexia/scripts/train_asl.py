#!/usr/bin/env python3
"""
Train an ASL letter MLP model from captured MediaPipe landmark samples.

Input dataset format (asl_dataset.json):
[
  {"label": "A", "x": [63 floats], "t": 1732450000000},
  ...
]

Outputs:
1) Terminal metrics (accuracy + classification report + confusion matrix)
2) Browser inference weights JSON at src/models/asl_mlp_weights.json
"""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np
from sklearn.metrics import classification_report, confusion_matrix
from sklearn.model_selection import train_test_split
import tensorflow as tf


DEFAULT_EXCLUDED = {"J", "Z"}
DEFAULT_MODEL_OUT = Path("src/models/asl_mlp_weights.json")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train ASL MLP classifier for browser inference")
    parser.add_argument(
        "--dataset",
        default="asl_dataset.json",
        help="Path to captured dataset JSON (default: asl_dataset.json)",
    )
    parser.add_argument(
        "--output",
        default=str(DEFAULT_MODEL_OUT),
        help=f"Output model JSON path (default: {DEFAULT_MODEL_OUT.as_posix()})",
    )
    parser.add_argument(
        "--include-jz",
        action="store_true",
        help="Include J and Z classes (excluded by default)",
    )
    parser.add_argument(
        "--epochs",
        type=int,
        default=60,
        help="Training epochs (default: 60)",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=32,
        help="Batch size (default: 32)",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=42,
        help="Random seed (default: 42)",
    )
    return parser.parse_args()


def load_samples(path: Path, include_jz: bool) -> List[dict]:
    if not path.exists():
        raise FileNotFoundError(f"Dataset file not found: {path}")

    with path.open("r", encoding="utf-8") as f:
        raw = json.load(f)

    if not isinstance(raw, list):
        raise ValueError("Dataset must be a JSON array of samples")

    samples: List[dict] = []
    for idx, row in enumerate(raw):
        if not isinstance(row, dict):
            continue

        label = str(row.get("label", "")).upper().strip()
        x = row.get("x")

        if len(label) != 1 or not label.isalpha():
            continue
        if (not include_jz) and (label in DEFAULT_EXCLUDED):
            continue
        if not isinstance(x, list) or len(x) != 63:
            continue

        try:
            vec = [float(v) for v in x]
        except (TypeError, ValueError):
            continue

        samples.append({"label": label, "x": vec, "idx": idx})

    if not samples:
        raise ValueError("No valid samples found after filtering")

    return samples


def build_xy(samples: List[dict]) -> Tuple[np.ndarray, np.ndarray, List[str], Dict[str, int]]:
    labels = sorted({s["label"] for s in samples})
    label_to_idx = {label: i for i, label in enumerate(labels)}

    X = np.array([s["x"] for s in samples], dtype=np.float32)
    y = np.array([label_to_idx[s["label"]] for s in samples], dtype=np.int32)

    return X, y, labels, label_to_idx


def make_model(num_classes: int) -> tf.keras.Model:
    model = tf.keras.Sequential(
        [
            tf.keras.layers.Input(shape=(63,), name="input_63"),
            tf.keras.layers.Dense(128, activation="relu", name="dense_128"),
            tf.keras.layers.Dense(64, activation="relu", name="dense_64"),
            tf.keras.layers.Dense(num_classes, activation="softmax", name="dense_logits"),
        ]
    )

    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=1e-3),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"],
    )
    return model


def export_browser_model(model: tf.keras.Model, labels: List[str], output_path: Path) -> None:
    dense_layers = [layer for layer in model.layers if isinstance(layer, tf.keras.layers.Dense)]
    export_layers = []

    for layer in dense_layers:
        weights, biases = layer.get_weights()
        activation = getattr(layer.activation, "__name__", "linear")
        export_layers.append(
            {
                "name": layer.name,
                "input_size": int(weights.shape[0]),
                "output_size": int(weights.shape[1]),
                "activation": "relu" if activation == "relu" else "linear",
                "weights": weights.tolist(),
                "biases": biases.tolist(),
            }
        )

    payload = {
        "model_type": "mlp",
        "input_size": 63,
        "labels": labels,
        "layers": export_layers,
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as f:
        json.dump(payload, f)


def main() -> None:
    args = parse_args()
    random.seed(args.seed)
    np.random.seed(args.seed)
    tf.random.set_seed(args.seed)

    dataset_path = Path(args.dataset)
    output_path = Path(args.output)

    samples = load_samples(dataset_path, include_jz=args.include_jz)
    X, y, labels, _ = build_xy(samples)

    if len(labels) < 2:
        raise ValueError("Need at least 2 distinct labels to train")

    counts = {label: int((y == i).sum()) for i, label in enumerate(labels)}
    for label, count in counts.items():
        if count < 2:
            raise ValueError(
                f"Label '{label}' has only {count} sample(s). Add more samples for stratified split."
            )

    X_train, X_val, y_train, y_val = train_test_split(
        X,
        y,
        test_size=0.2,
        random_state=args.seed,
        stratify=y,
    )

    model = make_model(num_classes=len(labels))

    callbacks: List[tf.keras.callbacks.Callback] = [
        tf.keras.callbacks.EarlyStopping(
            monitor="val_accuracy",
            patience=8,
            restore_best_weights=True,
        )
    ]

    model.fit(
        X_train,
        y_train,
        validation_data=(X_val, y_val),
        epochs=args.epochs,
        batch_size=args.batch_size,
        verbose=1,
        callbacks=callbacks,
    )

    eval_result = model.evaluate(X_val, y_val, verbose=0)
    if isinstance(eval_result, (list, tuple, np.ndarray)):
        val_loss = float(eval_result[0]) if len(eval_result) > 0 else float("nan")
        val_acc = float(eval_result[1]) if len(eval_result) > 1 else float("nan")
    else:
        val_loss = float(eval_result)
        val_acc = float("nan")

    if np.isnan(val_acc):
        print(f"\nValidation loss: {val_loss:.4f}\n")
    else:
        print(f"\nValidation accuracy: {val_acc:.4f}")
        print(f"Validation loss: {val_loss:.4f}\n")

    y_prob = model.predict(X_val, verbose=0)
    y_pred = np.argmax(y_prob, axis=1)

    print("Classification report:")
    print(classification_report(y_val, y_pred, target_names=labels, digits=4, zero_division=0))

    cm = confusion_matrix(y_val, y_pred, labels=np.arange(len(labels)))
    print("Confusion matrix (rows=true, cols=pred):")
    print(cm)

    export_browser_model(model, labels, output_path)
    print(f"\nExported browser model JSON to: {output_path.as_posix()}")


if __name__ == "__main__":
    main()
