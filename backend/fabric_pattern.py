"""Detect source-pixel repeats and align their phase at fabric joins."""

import cv2
import numpy as np


def repeat_period(values: np.ndarray, axis: int) -> int | None:
    """Accept a repeat only when its first and second offsets both agree."""
    values = np.moveaxis(values, axis, 0)
    best: tuple[float, int] | None = None
    for period in range(3, min(32, len(values) // 3) + 1):
        scores = []
        for shift in (period, period * 2):
            a, b = values[:-shift], values[shift:]
            denom = float(np.linalg.norm(a) * np.linalg.norm(b))
            scores.append(float((a * b).sum()) / denom if denom else 0)
        strength = min(scores)
        if strength > 0.78 and (best is None or strength > best[0] + 0.025):
            best = strength, period
    return best[1] if best else None


def pattern_fill(source: np.ndarray, shape: tuple[int, int], phase: int,
                 seed: np.ndarray | None = None) -> np.ndarray | None:
    """Tile an observed repeat with pixel copies at the existing fabric scale."""
    luma = cv2.cvtColor(source[:, :, :3], cv2.COLOR_RGB2GRAY).astype(np.float32)
    highpass = luma - cv2.GaussianBlur(luma, (0, 0), 2)
    if highpass.std() < 3:
        return None
    row_period = repeat_period(highpass, 0)
    col_period = repeat_period(highpass, 1)
    if row_period is None and col_period is None:
        return None

    height, width = shape

    def source_indices(indices, size, period, offset):
        if period is None:
            return reflected_indices(indices + offset, size)
        return (size - period) // 2 + (indices + offset) % period

    row_phase, col_phase = phase, phase
    if seed is not None:
        ys, xs = np.nonzero(seed[..., 3] == 255)
        if len(ys):
            # Align the pattern phase to the photographed pixels next to the
            # gap. Subsample the anchors to bound the batch for larger faces.
            indices = np.linspace(0, len(ys) - 1, min(256, len(ys)), dtype=int)
            ys, xs = ys[indices], xs[indices]
            rgb = seed[ys, xs, :3].astype(np.float32)
            row_choices = np.arange(row_period) if row_period else np.array([phase])
            col_choices = np.arange(col_period) if col_period else np.array([phase])
            rows = source_indices(ys[None, :], source.shape[0], row_period, row_choices[:, None])
            cols = source_indices(xs[None, :], source.shape[1], col_period, col_choices[:, None])
            copies = source[rows[:, None, :], cols[None, :, :], :3]
            costs = np.abs(copies.astype(np.float32) - rgb).mean(axis=(2, 3))
            best_row, best_col = np.unravel_index(costs.argmin(), costs.shape)
            row_phase, col_phase = row_choices[best_row], col_choices[best_col]
    rows = source_indices(np.arange(height), source.shape[0], row_period, row_phase)
    cols = source_indices(np.arange(width), source.shape[1], col_period, col_phase)
    return source[rows[:, None], cols[None, :]]


def reflected_indices(indices: np.ndarray, size: int) -> np.ndarray:
    positions = indices % (2 * size)
    return np.minimum(positions, 2 * size - positions - 1)
