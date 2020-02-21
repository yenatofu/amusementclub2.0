const msToTime          = require('pretty-ms')
const {cmd}             = require('../utils/cmd')
const colors            = require('../utils/colors')
const asdate            = require('add-subtract-date')
const _                 = require('lodash')

const {
    claimCost,
    promoClaimCost,
    XPtoLEVEL
} = require('../utils/tools')

const {
    formatName,
    withCards,
    withGlobalCards,
    parseArgs,
    filter,
    mapUserCards
} = require('../modules/card')

const {
    fetchOnly
} = require('../modules/user')

const {
    addGuildXP,
    getBuilding
} = require('../modules/guild')

const {
    withUserItems,
    useItem,
    getQuestion
} = require('../modules/item')

const {
    getPending
} = require('../modules/transaction')

cmd('bal', (ctx, user) => {
    let max = 1
    const now = new Date()
    const promo = ctx.promos.filter(x => x.starts < now && x.expires > now)[0]
    while(claimCost(user, ctx.guild.tax, max) < user.exp)
        max++

    const embed = {
        color: colors.green,
        description: `you have **${Math.round(user.exp)}** ${ctx.symbols.tomato} and **${Math.round(user.vials)}** ${ctx.symbols.vial}
            Your next claim will cost **${claimCost(user, 0, 1)}** ${ctx.symbols.tomato}
            Next claim in current guild: **${claimCost(user, ctx.guild.tax, 1)}** ${ctx.symbols.tomato} (+${ctx.guild.tax * 100}% claim tax)
            You can claim **${max - 1} cards** in current guild with your balance`
    }

    if(promo) {
        max = 1
        while(promoClaimCost(user, max) < user.promoexp)
            max++

        embed.fields = [{
            name: `Promo balance`,
            value: `You have **${Math.round(user.promoexp)}** ${promo.currency}
                Your next claim will cost ${promoClaimCost(user, 1)} ${promo.currency}
                You can claim **${max - 1} ${promo.name} cards** in current guild with your balance`
        }]
    }

    return ctx.reply(user, embed)
}).access('dm')

cmd('inv', withUserItems((ctx, user, items, args) => {
    const title = `To view the item details use \`->item info [item id]\`
                    To use the item \`->inv use [item id]\`\n\n`

    return ctx.pgn.addPagination(user.discord_id, ctx.msg.channel.id, {
        pages: ctx.pgn.getPages(items.map((x, i) => `${i+1}. \`${x.id}\` **${x.name}**`)),
        buttons: ['back', 'forward'],
        embed: {
            author: { name: `${user.username}, your inventory (${items.length} results)` },
            color: colors.blue,
        }
    })
}))

cmd(['inv', 'use'], withUserItems((ctx, user, items, args) => {
    const item = items[0]

    return ctx.pgn.addConfirmation(user.discord_id, ctx.msg.channel.id, {
        force: ctx.globals.force,
        question: getQuestion(ctx, user, item),
        onConfirm: (x) => useItem(ctx, user, item)
    })
}))

cmd('daily', async (ctx, user) => {
    user.lastdaily = user.lastdaily || new Date(0)

    const now = new Date()
    const future = asdate.add(user.lastdaily, 20, 'hours')

    if(future < now) {
        const quests = []
        const gbank = getBuilding(ctx, 'gbank')
        const tavern = getBuilding(ctx, 'tavern')
        const amount = gbank? 500 : 300
        const promo = ctx.promos.filter(x => x.starts < now && x.expires > now)[0]
        const boosts = ctx.boosts.filter(x => x.starts < now && x.expires > now)

        user.lastdaily = now
        user.dailystats = {}
        user.exp += amount
        user.xp += 10
        user.dailyquests = []
        user.markModified('dailystats')

        if(tavern) {
            quests.push(_.sample(ctx.quests.daily.filter(x => x.tier < 2)))
            user.dailyquests.push(quests[0].id)

            if(tavern.level > 1) {
                quests.push(_.sample(ctx.quests.daily.filter(x => x.tier > 1)))
                user.dailyquests.push(quests[1].id)
            }
        }
        user.markModified('dailyquests')
        await user.save()

        addGuildXP(ctx, user, 10)
        ctx.guild.balance += (gbank && gbank.level > 2)? XPtoLEVEL(user.xp) : 0
        await ctx.guild.save()

        const fields = []
        if(quests.length > 0) {
            fields.push({
                name: `Daily quests`, 
                value: quests.map((x, i) => `${i + 1}. ${x.name} (${x.reward(ctx)})`).join('\n')
            })
        }

        const trs = (await getPending(ctx, user)).filter(x => x.from_id != user.discord_id)
        if(trs.length > 0) {
            const more = trs.splice(3, trs.length).length
            fields.push({name: `Incoming pending transactions`, 
                value: trs.map(x => `\`${x.id}\` ${formatName(ctx.cards[x.card])} from **${x.from}**`).join('\n') 
                    + (more > 0? `\nand **${more}** more...` : '')
            })
        }

        if(promo || boosts.length > 0) {
            fields.push({name: `Current events and boosts`,
                value: `${promo? `[${msToTime(promo.expires - now, {compact: true})}] **${promo.name}** event (\`->claim promo\`)` : ''}
                ${boosts.map(x => `Increased drop rate for **${x.name}** (\`->claim ${x.id}\`)`).join('\n')}`
            })
        }

        return ctx.reply(user, {
            description: `you recieved daily **${amount}** ${ctx.symbols.tomato} 
                You have now **${Math.round(user.exp)}** ${ctx.symbols.tomato}`,
            color: colors.green,
            fields
        })
    }

    return ctx.reply(user, `you can claim your daily in **${msToTime(future - now)}**`, 'red')
})

cmd('cards', 'li', 'ls', withCards(async (ctx, user, cards, parsedargs) => {
    const now = new Date()
    const cardstr = cards.map(c => {
        const isnew = c.obtained > (user.lastdaily || now)
        return (isnew? '**[new]** ' : '') + formatName(c) + (c.amount > 1? `(x${c.amount})` : '')
    })

    return ctx.pgn.addPagination(user.discord_id, ctx.msg.channel.id, {
        pages: ctx.pgn.getPages(cardstr, 15),
        embed: { author: { name: `${user.username}, your cards (${cards.length} results)` } }
    })
})).access('dm')

cmd('profile', async (ctx, user, arg1) => {
    if(arg1) user = await fetchOnly(arg1)

    const cloutsum = user.completedcols.map(x => x.amount).reduce((a, b) => a + b, 0)
    const stamp = user._id.getTimestamp()
    const cards = mapUserCards(ctx, user)
    const stampString = `${stamp.getFullYear()}.${(stamp.getMonth()+1)}.${stamp.getDate()}`

    const resp = []
    resp.push(`Level: **${XPtoLEVEL(user.xp)}**`)
    resp.push(`Cards: **${user.cards.length}** | Stars: **${cards.map(x => x.level).reduce((a, b) => a + b, 0)}**`)
    resp.push(`In game since: **${stampString}** (${msToTime(new Date() - stamp, {compact: true})})`)

    if(cloutsum > 0) {
        resp.push(`Completed collections: **${user.completedcols.length}**`)
        resp.push(`Overall clout: **${cloutsum}**`)
    }

    if(user.roles && user.roles.length > 0)
        resp.push(`Roles: **${user.roles.join(" **|** ")}**`)

    return ctx.send(ctx.msg.channel.id, {
        description: resp.join('\n'),
        color: colors['yellow'],
        author: {
            name: `${user.username} (${user.discord_id})`
        },
        thumbnail: {
            url: ctx.bot.users.filter(x => x.id === user.discord_id)[0].avatarURL
        }
    }, user.discord_id)
}).access('dm')

cmd('diff', async (ctx, user, ...args) => {
    const newArgs = parseArgs(ctx, args)

    if(!newArgs.ids[0])
        return ctx.reply(user, `please include ID of other user`, 'red')

    const otherUser = await fetchOnly(newArgs.ids[0])
    const otherCards = filter(mapUserCards(ctx, otherUser), newArgs)

    if(otherCards.length === 0)
        return ctx.reply(user, `**${otherUser.username}** doesn't have any cards matching this request`, 'red')

    const ids = user.cards.map(x => x.id)
    const diff = otherCards.filter(x => ids.indexOf(x.id) === -1)
        .sort(newArgs.sort)

    if(diff.length === 0)
        return ctx.reply(user, `no different cards found`, 'red')

    return ctx.pgn.addPagination(user.discord_id, ctx.msg.channel.id, {
        pages: ctx.pgn.getPages(diff.map(x => formatName(x)), 15),
        embed: { author: { name: `${user.username}, your difference with ${otherUser.username} (${diff.length} results)` } }
    })
})

cmd('miss', withGlobalCards(async (ctx, user, cards, parsedargs) => {
    const ids = user.cards.map(x => x.id)
    const diff = cards.filter(x => ids.indexOf(x.id) === -1)
        .sort(parsedargs.sort)

    if(diff.length === 0)
        return ctx.reply(user, `you have all cards matching this request!`)

    return ctx.pgn.addPagination(user.discord_id, ctx.msg.channel.id, {
        pages: ctx.pgn.getPages(diff.map(x => formatName(x)), 15),
        embed: { author: { name: `${user.username}, cards that you don't have (${diff.length} results)` } }
    })
}))

cmd('quest', 'quests', async (ctx, user) => {
    if(user.dailyquests.length === 0 && user.questlines.length === 0)
        return ctx.reply(user, `you don't have any quests`, 'red')

    return ctx.send(ctx.msg.channel.id, {
        color: colors.blue,
        author: { name: `${user.username}, your quests:` },
        description: ctx.quests.daily.filter(x => user.dailyquests.some(y => x.id === y))
            .map((x, i) => `${i + 1}. ${x.name} (${x.reward(ctx)})`).join('\n') 
    }, user.discord_id)
})
