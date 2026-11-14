import type { ComponentProps } from 'react';
import type { IconComponent, IconName } from '@repo/design-system/lib/icon-context';
import {
    RiAddLine,
    RiArrowDownLine,
    RiArrowDownSLine,
    RiArrowLeftLine,
    RiArrowRightLine,
    RiArrowRightSLine,
    RiArrowUpLine,
    RiBookShelfLine,
    RiBrainLine,
    RiBrushLine,
    RiCalendarLine,
    RiChat3Line,
    RiCheckLine,
    RiCircleFill,
    RiCircleLine,
    RiCloseLine,
    RiComputerLine,
    RiDeleteBinLine,
    RiCornerDownLeftLine,
    RiCornerDownRightLine,
    RiDragMove2Line,
    RiDraggable,
    RiDropperLine,
    RiEqualizerLine,
    RiErrorWarningLine,
    RiExpandUpDownLine,
    RiFileCopyLine,
    RiFileLine,
    RiFilter3Line,
    RiFolderLine,
    RiFullscreenExitLine,
    RiFullscreenLine,
    RiGlobalLine,
    RiGroupLine,
    RiHeartLine,
    RiHomeLine,
    RiImageLine,
    RiInboxLine,
    RiInformationLine,
    RiLayoutRightLine,
    RiLightbulbLine,
    RiLink,
    RiLoader4Line,
    RiLockLine,
    RiMailLine,
    RiMenuLine,
    RiMoonLine,
    RiMore2Line,
    RiMoreLine,
    RiNotification3Line,
    RiPaletteLine,
    RiPauseLine,
    RiPencilLine,
    RiPlayLine,
    RiPriceTag3Line,
    RiRectangleLine,
    RiRestartLine,
    RiRocketLine,
    RiSearchLine,
    RiSettings3Line,
    RiShieldLine,
    RiSideBarLine,
    RiSkipForwardLine,
    RiSquareLine,
    RiStarLine,
    RiSubtractLine,
    RiSunLine,
    RiTimeLine,
    RiUserLine,
    RiArrowRightUpLine,
    RiFileTextLine,
    RiListUnordered,
    RiLayoutGridLine,
    RiUpload2Line,
    RiScan2Line,
    RiLogoutBoxRLine,
    RiFileList2Line,
    RiFileUploadLine,
    RiRefreshLine,
} from '@remixicon/react';

// Adapt Remix's wider size type to the shared Fluid icon contract.
function remix(Icon: typeof RiAddLine) {
    return function RemixIcon({ size = 16, ...props }: Omit<ComponentProps<typeof RiAddLine>, 'size'> & { size?: number }) {
        return <Icon aria-hidden="true" {...props} size={size} />;
    };
}

export const remixIcons: Record<IconName, IconComponent> = {
    'chevron-right': remix(RiArrowRightSLine),
    'chevron-down': remix(RiArrowDownSLine),
    x: remix(RiCloseLine),
    copy: remix(RiFileCopyLine),
    menu: remix(RiMenuLine),
    dot: remix(RiCircleFill),
    monitor: remix(RiComputerLine),
    sun: remix(RiSunLine),
    moon: remix(RiMoonLine),
    'rectangle-horizontal': remix(RiRectangleLine),
    circle: remix(RiCircleLine),
    square: remix(RiSquareLine),
    'square-library': remix(RiBookShelfLine),
    clock: remix(RiTimeLine),
    star: remix(RiStarLine),
    settings: remix(RiSettings3Line),
    plus: remix(RiAddLine),
    'arrow-left': remix(RiArrowLeftLine),
    'arrow-right': remix(RiArrowRightLine),
    'arrow-up': remix(RiArrowUpLine),
    'arrow-down': remix(RiArrowDownLine),
    search: remix(RiSearchLine),
    loader: remix(RiLoader4Line),
    users: remix(RiGroupLine),
    lock: remix(RiLockLine),
    mail: remix(RiMailLine),
    bell: remix(RiNotification3Line),
    shield: remix(RiShieldLine),
    palette: remix(RiPaletteLine),
    lightbulb: remix(RiLightbulbLine),
    rocket: remix(RiRocketLine),
    heart: remix(RiHeartLine),
    paintbrush: remix(RiBrushLine),
    brain: remix(RiBrainLine),
    globe: remix(RiGlobalLine),
    user: remix(RiUserLine),
    image: remix(RiImageLine),
    link: remix(RiLink),
    check: remix(RiCheckLine),
    'rotate-ccw': remix(RiRestartLine),
    play: remix(RiPlayLine),
    pause: remix(RiPauseLine),
    pipette: remix(RiDropperLine),
    home: remix(RiHomeLine),
    'message-circle': remix(RiChat3Line),
    inbox: remix(RiInboxLine),
    pencil: remix(RiPencilLine),
    scaling: remix(RiDragMove2Line),
    'skip-forward': remix(RiSkipForwardLine),
    'corner-down-right': remix(RiCornerDownRightLine),
    'corner-down-left': remix(RiCornerDownLeftLine),
    'panel-left': remix(RiSideBarLine),
    'panel-right': remix(RiLayoutRightLine),
    'chevrons-up-down': remix(RiExpandUpDownLine),
    'more-horizontal': remix(RiMoreLine),
    'more-vertical': remix(RiMore2Line),
    calendar: remix(RiCalendarLine),
    folder: remix(RiFolderLine),
    'sliders-horizontal': remix(RiEqualizerLine),
    info: remix(RiInformationLine),
    'circle-alert': remix(RiErrorWarningLine),
    file: remix(RiFileLine),
    minus: remix(RiSubtractLine),
    maximize: remix(RiFullscreenLine),
    minimize: remix(RiFullscreenExitLine),
    'grip-vertical': remix(RiDraggable),
    tag: remix(RiPriceTag3Line),
    filter: remix(RiFilter3Line),
};

export const Plus = remix(RiAddLine);
export const ChevronDown = remix(RiArrowDownSLine);
export const ArrowUpRight = remix(RiArrowRightUpLine);
export const FileText = remix(RiFileTextLine);
export const List = remix(RiListUnordered);
export const GridIcon = remix(RiLayoutGridLine);
export const ArrowLeft = remix(RiArrowLeftLine);
export const ArrowRight = remix(RiArrowRightLine);
export const Upload = remix(RiUpload2Line);
export const Check = remix(RiCheckLine);
export const X = remix(RiCloseLine);
export const Trash2 = remix(RiDeleteBinLine);
export const ScanLine = remix(RiScan2Line);
export const LogOut = remix(RiLogoutBoxRLine);
export const FileStack = remix(RiFileList2Line);
export const ArrowUp = remix(RiArrowUpLine);
export const FileUp = remix(RiFileUploadLine);
export const RefreshCw = remix(RiRefreshLine);

export const XIcon = X;
export const CheckIcon = Check;
export const ChevronRightIcon = remix(RiArrowRightSLine);
export const CircleIcon = remix(RiCircleLine);
