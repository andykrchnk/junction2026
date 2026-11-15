# Third-party material and submission permissions

The [submission review license](LICENSE) covers only original material that the
project contributors have the right to license. It does not relicense upstream
code, assets, datasets or dependencies. Preserve upstream notices when copying
or distributing their material, including modified copies.

## Junction submission terms

Checked on 15 November 2026: the [official Junction 2026 FAQ](https://2026.hackjunction.com/#faq)
says submissions are released under MIT, while teams retain ownership. Our
submission-only license does not meet that published MIT requirement. Obtain
Junction's written approval for an exception before relying on it for submission;
no approval is recorded here. Check the accepted [event terms](https://www.hackjunction.com/terms-of-service)
and challenge-specific agreements as well. This repository cannot revoke rights
already granted under those agreements.

## Bundled source and font

| Material                                                | Location                                                                                                                  | Upstream terms and notices                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fluid Functionalism registry components and adaptations | `packages/design-system/src`                                                                                              | MIT, copyright 2026 Micka Touillaud. Preserve the [existing license](apps/app/public/fluid-functionalism-LICENSE.txt). [Upstream](https://www.fluidfunctionalism.com/docs).                                                                                                                                                            |
| shadcn/ui components and adaptations                    | `packages/design-system/src/components/ui`                                                                                | MIT, copyright shadcn. Preserve the [bundled license](licenses/shadcn-ui-MIT.txt). [Upstream](https://github.com/shadcn-ui/ui).                                                                                                                                                                                                        |
| Geist Serif Regular font                                | `packages/design-system/src/assets/GeistSerif-Regular.woff2`                                                              | SIL Open Font License 1.1, copyright 2023 Vercel, in collaboration with basement.studio. Preserve the [bundled license](licenses/Geist-OFL-1.1.txt), copied from the installed `geist` package. [Upstream](https://github.com/vercel/geist-font).                                                                                      |
| CubiCasa5K model definition and structural polygonizer  | `packages/processing/cubicasa/model/segmentation_net.py`, `packages/processing/cubicasa/utils/official_postprocessing.py` | CC BY-NC 4.0, copyright 2019 CubiCasa. See the [existing provenance and modification notice](packages/processing/cubicasa/NOTICE.md), [upstream license](https://github.com/CubiCasa/CubiCasa5k/blob/master/LICENSE) and [license terms](https://creativecommons.org/licenses/by-nc/4.0/). Noncommercial restrictions remain in force. |

These notices do not make all code in a listed directory third-party code, and
do not change the licenses of original upstream portions when we modify them.

### Unresolved inference-wrapper permission

The [CubiCasa notice](packages/processing/cubicasa/NOTICE.md) records that the
original inference wrapper came from [Aswi-ni/CubicasaRoomSegmentation](https://github.com/Aswi-ni/CubicasaRoomSegmentation).
At review on 15 November 2026, that repository had no declared license. Its
public availability is not evidence of a general redistribution license.
Permission for copied wrapper portions remains unverified; our submission-only
license grants no rights to those portions. Obtain permission or replace those
portions with independently authored code before further distribution. This
notice alone does not resolve that issue.

## Challenge data and research

`datasets/stoa-dataset/questions.jsonl` is supplied challenge data, not original
project code. The [dataset README](datasets/stoa-dataset/README.md#licences)
states that questions inherit the license of the drawing they refer to. The
tracked questions reference `cubicasa5k`, `swiss_dwellings`, `opening_design`,
`ifc_models` and `ifc_bench`; these sources have different licenses, including
noncommercial, attribution and share-alike conditions. Do not apply the root
license to these questions or describe the dataset as MIT-licensed.

The original drawing files and their source-specific license/credit files live
under the Git-ignored `datasets/stoa-dataset/data/` directory. They are not
included in this repository. The overview README does not replace those credits.
Before sharing the questions or drawings, verify the supplied challenge terms,
include the applicable source/file credits and licenses, or exclude that data
from the distributed copy. These notices do not establish redistribution permission
or remove data from Git history.

Supplied dataset descriptions, inventories and research material under `research/`
also retain any applicable upstream rights. Links to a dataset or preview are
not grants of permission to redistribute its contents.

## Dependencies, downloaded models and other assets

Packages installed through pnpm or Python retain their own licenses. The lockfile
and requirements files identify dependencies; the root license does not replace
their terms or the notices required when distributing a built application.
Downloaded model checkpoints have separate terms; they are not licensed by this
project. In particular, do not infer commercial rights to CubiCasa weights from
permission to review our application code.

The application uses the tldraw SDK; production use requires an appropriate SDK
license as described in the [application README](README.md#canvas-workspace).
Repository access does not transfer a production SDK license or service/API
credentials. Other copied images, icons and assets retain their owners' rights;
this notice does not certify permissions where provenance is not documented.
