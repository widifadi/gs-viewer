import numpy as np
from plyfile import PlyData
import os
import argparse
import glob
import shapefile
import shapely
from shapely.geometry import shape, Polygon

def sigmoid(x):
    return 1 / (1 + np.exp(-np.clip(x, -88, 88)))

def ply_to_splat(ply_path, out_path, opacity_threshold=0, clip_polygon=None):
    print(f"Reading {ply_path} ...")
    ply = PlyData.read(ply_path)
    v = ply['vertex']
    n = len(v)
    print(f" {n:,} Gaussians")

    # Position
    x = np.array(v['x'], dtype=np.float32)
    y = np.array(v['y'], dtype=np.float32)
    z = np.array(v['z'], dtype=np.float32)

    # Scale: log-space -> linear
    sx = np.exp(np.array(v['scale_0'], dtype=np.float32))
    sy = np.exp(np.array(v['scale_1'], dtype=np.float32))
    sz = np.exp(np.array(v['scale_2'], dtype=np.float32))

    # Color from DC spherical harmonic coefficients
    C0 = 0.28209479177387814  # 1 / (2 * sqrt(pi))
    r = np.clip((0.5 + C0 * np.array(v['f_dc_0'], dtype=np.float32)) * 255, 0, 255).astype(np.uint8)
    g = np.clip((0.5 + C0 * np.array(v['f_dc_1'], dtype=np.float32)) * 255, 0, 255).astype(np.uint8)
    b = np.clip((0.5 + C0 * np.array(v['f_dc_2'], dtype=np.float32)) * 255, 0, 255).astype(np.uint8)

    # Opacity: logit -> sigmoid -> uint8
    a = np.clip(sigmoid(np.array(v['opacity'], dtype=np.float32)) * 255, 0, 255).astype(np.uint8)

    # Rotation quaternion: PLY stores (w, x, y, z) but we want (x, y, z, w)
    rw = np.array(v["rot_0"], dtype=np.float32)
    rx = np.array(v["rot_1"], dtype=np.float32)
    ry = np.array(v["rot_2"], dtype=np.float32)
    rz = np.array(v["rot_3"], dtype=np.float32)

    # Optional spatial clip using polygon (vectorized with shapely 2.x)
    if clip_polygon is not None:
        clip_mask = shapely.contains_xy(clip_polygon, x.astype(np.float64), y.astype(np.float64))
        x, y, z = x[clip_mask], y[clip_mask], z[clip_mask]
        sx, sy, sz = sx[clip_mask], sy[clip_mask], sz[clip_mask]
        r, g, b, a = r[clip_mask], g[clip_mask], b[clip_mask], a[clip_mask]
        rw, rx, ry, rz = rw[clip_mask], rx[clip_mask], ry[clip_mask], rz[clip_mask]
        n = int(clip_mask.sum())
        total_before = len(clip_mask)
        print(f"  After clip: {n:,} Gaussians ({100*n/total_before:.0f}% kept)")
        if n == 0:
            print("  WARNING: 0 Gaussians after clip — skipping file.")
            return

    # Optional opacity pruning — apply mask to all arrays at once
    if opacity_threshold > 0:
        mask = a > opacity_threshold
        x, y, z = x[mask], y[mask], z[mask]
        sx, sy, sz = sx[mask], sy[mask], sz[mask]
        r, g, b, a = r[mask], g[mask], b[mask], a[mask]
        rw, rx, ry, rz = rw[mask], rx[mask], ry[mask], rz[mask]
        total_before_prune = len(mask)
        n = int(mask.sum())
        print(f"  After pruning: {n:,} Gaussians ({100*n/total_before_prune:.0f}% kept)")
    norm = np.sqrt(rx**2 + ry**2 + rz**2 + rw**2)
    norm = np.where(norm == 0, 1.0, norm)  # Avoid division by zero
    rw /= norm; rx /= norm; ry /= norm; rz /= norm
    qx = np.clip(rx * 128 + 128, 0, 255).astype(np.uint8)
    qy = np.clip(ry * 128 + 128, 0, 255).astype(np.uint8)
    qz = np.clip(rz * 128 + 128, 0, 255).astype(np.uint8)
    qw = np.clip(rw * 128 + 128, 0, 255).astype(np.uint8)

    # Pack into 32-byte records:
    # [x f32][y f32][z f32][sx f32][sy f32][sz f32][r u8][g u8][b u8][a u8][qx u8][qy u8][qz u8][qw u8]
    buf = np.zeros((n, 32), dtype=np.uint8)
    for col, arr in zip(range(0, 24, 4), [x, y, z, sx, sy, sz]):
        buf[:, col:col+4] = arr.view(np.uint8).reshape(n, 4)
    buf[:, 24] = r; buf[:, 25] = g; buf[:, 26] = b; buf[:, 27] = a
    buf[:, 28] = qx; buf[:, 29] = qy; buf[:, 30] = qz; buf[:, 31] = qw

    with open(out_path, "wb") as f:
        f.write(buf.tobytes())

    size_mb = os.path.getsize(out_path) / (1024**2)
    print(f" Done: {out_path} ({size_mb:.2f} MB)\n")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Convert PLY to SPLAT format")
    parser.add_argument("--dir", default="data/Siti Inggil", help="Folder containing .ply files")
    parser.add_argument("--output", help="Output SPLAT file folder (default: same as input folder)")
    parser.add_argument("--opacity-threshold", type=int, default=0, dest="opacity_threshold",
                        help="Remove Gaussians with opacity below this value (0-255). 0 = no pruning. Try 5-15.")
    parser.add_argument("--clip", default=None,
                        help="Path to a .shp file (in local PLY coordinates) to spatially clip Gaussians.")
    args = parser.parse_args()

    clip_polygon = None
    if args.clip:
        sf = shapefile.Reader(args.clip)
        geom = shape(sf.shape(0).__geo_interface__)
        # PolylineZ (type 13) is read as LineString — close the ring to make a Polygon
        if geom.geom_type == "LineString":
            clip_polygon = Polygon(geom.coords)
        elif geom.geom_type == "MultiLineString":
            clip_polygon = Polygon(list(geom.geoms[0].coords))
        else:
            clip_polygon = geom
        print(f"Clip polygon loaded from {args.clip} (bounds: {clip_polygon.bounds})")

    ply_files = glob.glob(os.path.join(args.dir, "*.ply"))
    if not ply_files:
        print(f"No .ply files found in {args.dir}")
        raise SystemExit(1)
    
    for ply_path in sorted(ply_files):
        base_name = os.path.splitext(os.path.basename(ply_path))[0]
        out_dir = args.output if args.output else args.dir
        os.makedirs(out_dir, exist_ok=True)
        out_path = os.path.join(out_dir, f"{base_name}.splat")
        ply_to_splat(ply_path, out_path, opacity_threshold=args.opacity_threshold, clip_polygon=clip_polygon)