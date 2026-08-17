#!/usr/bin/env python3
"""Transcribe a local F5 render and report normalized word error rate against its source."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

import librosa
import torch
import transformers.pipelines.automatic_speech_recognition as asr_pipeline_module
from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor, pipeline
from transformers.models.whisper.english_normalizer import BasicTextNormalizer, EnglishTextNormalizer

# Promptus bundles TorchCodec without the shared FFmpeg DLLs it needs. The ASR
# pipeline imports it opportunistically even for an already-decoded numpy array.
# Disable only that optional path inside this diagnostic process.
asr_pipeline_module.is_torchcodec_available = lambda: False


def words(value: str) -> list[str]:
    return re.findall(r"[a-z0-9]+(?:'[a-z0-9]+)?", value.casefold())


def edit_distance(reference: list[str], hypothesis: list[str]) -> int:
    previous = list(range(len(hypothesis) + 1))
    for index, expected in enumerate(reference, start=1):
        current = [index]
        for other, actual in enumerate(hypothesis, start=1):
            current.append(min(
                current[-1] + 1,
                previous[other] + 1,
                previous[other - 1] + (expected != actual),
            ))
        previous = current
    return previous[-1]


def edit_breakdown(reference: list[str], hypothesis: list[str]) -> dict[str, int]:
    """Return privacy-safe Levenshtein operation counts without exposing recognized text."""
    rows = len(reference) + 1
    columns = len(hypothesis) + 1
    matrix = [[0] * columns for _ in range(rows)]
    for index in range(rows):
        matrix[index][0] = index
    for index in range(columns):
        matrix[0][index] = index
    for row in range(1, rows):
        for column in range(1, columns):
            matrix[row][column] = min(
                matrix[row - 1][column] + 1,
                matrix[row][column - 1] + 1,
                matrix[row - 1][column - 1]
                + (reference[row - 1] != hypothesis[column - 1]),
            )

    substitutions = deletions = insertions = 0
    row, column = len(reference), len(hypothesis)
    while row or column:
        if row and column and reference[row - 1] == hypothesis[column - 1]:
            row -= 1
            column -= 1
        elif row and column and matrix[row][column] == matrix[row - 1][column - 1] + 1:
            substitutions += 1
            row -= 1
            column -= 1
        elif row and matrix[row][column] == matrix[row - 1][column] + 1:
            deletions += 1
            row -= 1
        else:
            insertions += 1
            column -= 1
    return {
        "substitutions": substitutions,
        "deletions": deletions,
        "insertions": insertions,
        "distance": matrix[-1][-1],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("audio", type=Path)
    parser.add_argument("source", type=Path, nargs="?")
    parser.add_argument("--model", default="openai/whisper-small.en")
    parser.add_argument("--cache-dir", type=Path, required=True)
    parser.add_argument(
        "--write-transcript",
        type=Path,
        help="Write locally recognized speech to this file without printing it",
    )
    args = parser.parse_args()
    if args.source is None and args.write_transcript is None:
        parser.error("source is required unless --write-transcript is provided")

    device = "cuda:0" if torch.cuda.is_available() else "cpu"
    dtype = torch.float16 if device.startswith("cuda") else torch.float32
    model = AutoModelForSpeechSeq2Seq.from_pretrained(
        args.model, dtype=dtype, low_cpu_mem_usage=True,
        use_safetensors=True, cache_dir=args.cache_dir, local_files_only=True,
    ).to(device)
    processor = AutoProcessor.from_pretrained(
        args.model, cache_dir=args.cache_dir, local_files_only=True
    )
    transcriber = pipeline(
        "automatic-speech-recognition", model=model,
        tokenizer=processor.tokenizer, feature_extractor=processor.feature_extractor,
        dtype=dtype, device=device,
    )
    audio, _ = librosa.load(args.audio, sr=16000, mono=True)
    # Whisper has its own long-form segmentation and timestamp logic.  Passing
    # chunk_length_s through the generic seq2seq pipeline creates overlapping
    # windows; on long, rhythmic narration those windows can repeat whole
    # passages and inflate the apparent word count.  Let Whisper perform its
    # native long-form decode so the verifier measures the audio rather than an
    # experimental pipeline chunking artefact.
    result = transcriber(audio, return_timestamps=True)
    recognized_text = result["text"].strip()
    hypothesis_words = words(recognized_text)
    report = {
        "model": args.model,
        "device": device,
        "recognized_words": len(hypothesis_words),
        "recognized_text_sha256": hashlib.sha256(recognized_text.encode("utf-8")).hexdigest(),
        "timestamped_chunks": len(result.get("chunks", [])),
        "long_form_mode": "whisper_native",
        "word_verifier_strategy": "whisper_native_long_form_v1",
    }
    if args.write_transcript is not None:
        args.write_transcript.write_text(recognized_text + "\n", encoding="utf-8")
        report["transcript_written"] = True
    if args.source is not None:
        source_text = args.source.read_text(encoding="utf-8-sig")
        reference_words = words(source_text)
        distance = edit_distance(reference_words, hypothesis_words)
        spelling = getattr(processor.tokenizer, "english_spelling_normalizer", None)
        normalizer = (
            EnglishTextNormalizer(spelling)
            if isinstance(spelling, dict)
            else BasicTextNormalizer()
        )
        normalized_reference = words(normalizer(source_text))
        normalized_hypothesis = words(normalizer(recognized_text))
        normalized_edits = edit_breakdown(normalized_reference, normalized_hypothesis)
        normalized_distance = normalized_edits["distance"]
        report.update({
            "reference_words": len(reference_words),
            "recognized_word_ratio": round(
                len(hypothesis_words) / max(1, len(reference_words)), 3
            ),
            "edit_distance": distance,
            "word_error_rate_percent": round(
                distance / max(1, len(reference_words)) * 100, 2
            ),
            "normalized_reference_words": len(normalized_reference),
            "normalized_recognized_words": len(normalized_hypothesis),
            "normalized_edit_distance": normalized_distance,
            "normalized_substitutions": normalized_edits["substitutions"],
            "normalized_deletions": normalized_edits["deletions"],
            "normalized_insertions": normalized_edits["insertions"],
            "normalized_word_error_rate_percent": round(
                normalized_distance / max(1, len(normalized_reference)) * 100, 2
            ),
            "normalizer": type(normalizer).__name__,
        })
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
