import { client } from '#client'
import { DISTUBE_OPTIONS } from '#features/music/distube-config.js'
import { DisTube } from 'distube'

export const player = new DisTube(client, DISTUBE_OPTIONS)
