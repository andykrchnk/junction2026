The model definition in `model/segmentation_net.py` derives from
[CubiCasa5K](https://github.com/CubiCasa/CubiCasa5k), copyright 2019,
licensed under [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/).
The pretrained checkpoint is distributed separately by that project under its
applicable terms. Commercial deployment requires reviewing those terms.

The original inference wrapper was obtained from
[CubicasaRoomSegmentation](https://github.com/Aswi-ni/CubicasaRoomSegmentation).
Local changes correct preprocessing, add confidence output and provide HTTP
serving and containers.

The structural polygonizer in `utils/official_postprocessing.py` is copied from
CubiCasa5k commit `c34440266665a11f4484eb06cd2e4b7d72ad76c1`,
`floortrans/post_prosessing.py`, under the same CC BY-NC 4.0 licence.
Compatibility changes retain dimensions in SciPy `stats.mode` and use Shapely's
`.geoms` to iterate multipart geometry. The room-instance extractor and detail
adapter are local additions; semantic model weights are unchanged.
