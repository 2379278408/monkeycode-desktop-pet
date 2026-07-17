import { Tray, Menu, BrowserWindow, shell, app } from 'electron'
import path from 'path'

export class TrayManager {
  private tray: Tray | null = null
  private petWindow: BrowserWindow

  constructor(petWindow: BrowserWindow) {
    this.petWindow = petWindow
  }

  create(): void {
    const iconPath = path.join(__dirname, '../assets/tray-icon.ico')
    this.tray = new Tray(iconPath)

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Show/Hide Pet',
        click: () => {
          if (this.petWindow.isVisible()) {
            this.petWindow.hide()
          } else {
            this.petWindow.show()
          }
        },
      },
      {
        label: 'Open MonkeyCode',
        click: () => shell.openExternal('https://monkeycode-ai.com/console/tasks'),
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => app.quit(),
      },
    ])

    this.tray.setToolTip('MonkeyCode Desktop Pet')
    this.tray.setContextMenu(contextMenu)
  }

  updateTooltip(text: string): void {
    this.tray?.setToolTip(text)
  }
}
