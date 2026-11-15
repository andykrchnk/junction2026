The model definition in `model/segmentation_net.py` derives from
[CubiCasa5K](https://github.com/CubiCasa/CubiCasa5k), copyright 2019,
licensed under [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/).
The pretrained checkpoint is distributed separately by that project under its
applicable terms. Commercial deployment requires reviewing those terms.

The original inference wrapper was obtained from
[CubicasaRoomSegmentation](https://github.com/Aswi-ni/CubicasaRoomSegmentation).
Local changes correct preprocessing, add confidence output and provide HTTP
serving and containers.

As of 15 November 2026, the wrapper's upstream repository has no declared
license. Permission to redistribute its original portions remains unverified;
the root submission review license does not grant rights to those portions.
Obtain upstream permission or replace those portions before further
distribution. The CC BY-NC notice for CubiCasa5K does not establish a license
for independently authored wrapper code.

The structural polygonizer in `utils/official_postprocessing.py` is copied from
CubiCasa5k commit `c34440266665a11f4484eb06cd2e4b7d72ad76c1`,
`floortrans/post_prosessing.py`, under the same CC BY-NC 4.0 licence.
Compatibility changes retain dimensions in SciPy `stats.mode` and use Shapely's
`.geoms` to iterate multipart geometry. The room-instance extractor and detail
adapter are local additions; semantic model weights are unchanged.

Local performance changes use hash-based wall/fixture membership while retaining
upstream pair traversal, survivor order and tie-breaking. Wall pixel classes are
cached per reconstruction, and polygon classification reads the segmentation
without copying the full image for each polygon. Thresholds and class mappings
are unchanged.
