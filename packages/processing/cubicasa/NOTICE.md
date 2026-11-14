The model definition in `model/segmentation_net.py` derives from
[CubiCasa5K](https://github.com/CubiCasa/CubiCasa5k), copyright 2019,
licensed under [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/).
The pretrained checkpoint is distributed separately by that project under its
applicable terms. Commercial deployment requires reviewing those terms.

The original inference wrapper was obtained from
[CubicasaRoomSegmentation](https://github.com/Aswi-ni/CubicasaRoomSegmentation).
Local changes correct preprocessing, add confidence output and provide HTTP
serving and containers.
