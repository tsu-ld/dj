import { client } from '#client'
import { DisTube } from 'distube'
import { DISTUBE_OPTIONS } from '#features/music/distube-config.js'

export const player = new DisTube(client, DISTUBE_OPTIONS)
