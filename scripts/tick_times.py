#!/usr/bin/env python3
"""The rules' step time per tick in a big game, as a dot chart of its mean and tail for each build.

python3 scripts/tick_times.py review/tick-times-114.json out.svg
"""
import json
import sys

from data_graphs import (INK, INK_SOFT, SERIES, SHAPES, Svg, axes, better_hint, callout, caption,
                         footnote, host_specs, legend, marker, pct)

ROWS = [("mean", "mean"), ("p50", "median"), ("p99", "99th percentile"), ("p999", "99.9th percentile"),
        ("max", "worst")]


def main(src, out):
    data = json.load(open(src))
    series = data["series"]
    # The neutral last slot goes to the build before, the series of least interest.
    colors = SERIES[:len(series) - 1] + [SERIES[-1]]

    svg = Svg(860)
    top = caption(svg, 16, 22, "Rules step time per tick, eight computers late in a game",
                  "lower is better · " + data["game"])
    # A row to each statistic, the first at the top, on whole-number ticks the axis labels.
    n = len(ROWS)
    row = lambda i: n - 1 - i
    x, y, w, h = 170, top, 560, 34 * n
    xmap, ymap = axes(svg, x, y, w, h, (2, 100, "log"), (-0.5, n - 0.5), "CPU time per tick (ms, log)",
                      "statistic", xfmt=lambda v: f"{v:g}", yfmt=lambda v: ROWS[row(int(v))][1])
    better_hint(svg, x, y, w, h, where="axis", label="faster", reverse=True)

    # One point a row for each build, each build a little above or below the row's middle so none hides another.
    off = lambda si: (si - (len(series) - 1) / 2) * 8
    pts = [[(xmap(s[k]), ymap(row(i)) + off(si)) for i, (k, _) in enumerate(ROWS)]
           for si, s in enumerate(series)]
    for si, s in enumerate(series):
        for (k, label), (px, py) in zip(ROWS, pts[si]):
            marker(svg, SHAPES[si], px, py, colors[si], f"{s['name']}, {label}: {s[k]:g} ms")
    legend(svg, x + w, top - 12, [(s["name"], colors[i]) for i, s in enumerate(series)])

    # The tail is what drops frames: the 99th percentile before and after.
    after, before = series[0], series[-1]
    callout(svg, *pts[0][2], f"p99 {pct(after['p99'], before['p99'])}", dx=-30, dy=-20)
    callout(svg, *pts[0][4], f"worst {pct(after['max'], before['max'])}", dx=-64, dy=-10)

    # The ticks long enough to cost a frame or two.
    ty = y + h + 62
    svg.text(16, ty, "Ticks over 16 ms and over 33 ms in eight minutes (9,600 ticks):", size=11, fill=INK)
    for i, s in enumerate(series):
        svg.text(16 + 250 * i, ty + 18, f"{s['name']}: {s['over16']:,} and {s['over33']:,}", size=11,
                 fill=INK_SOFT, tabular=True)
    height = footnote(svg, [s["source"] for s in series], host_specs(), [data["load"]], ty + 24,
                      "https://github.com/nmoinvaz/mapmakers-war")
    open(out, "w").write(svg.finish(height))

    # The same numbers as a table.
    print(f"{'build':<12}" + "".join(f"{label:>18}" for _, label in ROWS) + f"{'>16 ms':>9}{'>33 ms':>9}")
    for s in series:
        print(f"{s['name']:<12}" + "".join(f"{s[k]:>18g}" for k, _ in ROWS) + f"{s['over16']:>9}{s['over33']:>9}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
